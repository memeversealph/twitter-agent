import { Scraper } from 'agent-twitter-client';
import * as fs from 'fs';
import * as path from 'path';
import * as https from 'https';
import * as readline from 'readline';
import { OpenAI } from 'openai';
import * as crypto from 'crypto';
import fetch from 'node-fetch';
import * as dns from 'dns';

// 设置 DNS 解析优先使用 IPv4
dns.setDefaultResultOrder('ipv4first');

// 使用 node-fetch
const customFetch = async (url: string) => {
  const agent = new https.Agent({
    family: 4, // 强制使用 IPv4
    timeout: 30000 // 30秒超时
  });
  return fetch(url, { agent });
};

interface ScraperMediaItem {
  type: string;
  url: string;
  localPath?: string;
  data?: Buffer;
}

interface MediaItem {
  type: string;
  data: Buffer;
  url?: string;
  path?: string;
}

interface Tweet {
  id: string;
  text: string;
  photos?: {
    id: string;
    url: string;
  }[];
  timeParsed: string;
  likes: number;
  retweets: number;
  replies: number;
}

interface QueuedTweet {
  text: string;
  media: MediaItem[];
}

export interface TwitterTrackerConfig {
  username: string;
  password: string;
  email?: string;
  trackedUsers: string[];
  checkInterval?: number;
  historyDir?: string;
  autoSendTweets?: boolean;
  tweetInterval?: number;
}

export class TwitterTracker {
  private scraper: any;
  private trackedUsers: Set<string>;
  private lastTweetIds: Map<string, string>;
  private checkInterval: number;
  private historyDir: string;
  private autoSendTweets: boolean;
  private lastSendTime: number = 0;
  private tweetInterval: number;
  private tweetQueue: QueuedTweet[] = [];
  private isTracking: boolean = false;
  private trackingInterval: NodeJS.Timeout | null = null;

  private tweetStats = {
    total: 0,
    withMedia: 0,
    sent: 0
  };

  private tweetRetryCount: Map<string, number> = new Map();

  constructor(config: TwitterTrackerConfig) {
    this.scraper = new Scraper();
    this.trackedUsers = new Set(config.trackedUsers);
    this.lastTweetIds = new Map();
    this.checkInterval = config.checkInterval || 60000;
    this.historyDir = config.historyDir || './twitter-history';
    this.isTracking = false;
    this.autoSendTweets = config.autoSendTweets || false;
    this.tweetInterval = config.tweetInterval || 60000;
    this.lastSendTime = Date.now();

    // 确保历史目录存在
    if (!fs.existsSync(this.historyDir)) {
      fs.mkdirSync(this.historyDir, { recursive: true });
    }

    // 确保媒体目录存在
    const mediaDir = path.join(this.historyDir, 'media');
    if (!fs.existsSync(mediaDir)) {
      fs.mkdirSync(mediaDir, { recursive: true });
    }

    // 设置登录信息
    (this.scraper as any).username = config.username;
    (this.scraper as any).password = config.password;
  }

  async initialize() {
    try {
      console.log('\n🔑 正在登录 Twitter...');
      
      // 验证环境变量
      if (!process.env.TWITTER_USERNAME || !process.env.TWITTER_PASSWORD) {
        throw new Error('缺少必要的环境变量: TWITTER_USERNAME 或 TWITTER_PASSWORD');
      }

      // 尝试登录
      await (this.scraper as any).login(
        process.env.TWITTER_USERNAME,
        process.env.TWITTER_PASSWORD,
        process.env.TWITTER_EMAIL
      );

      // 验证登录状态
      const isLoggedIn = await (this.scraper as any).isLoggedIn();
      if (!isLoggedIn) {
        throw new Error('登录验证失败');
      }

      console.log(`✅ 登录成功！用户: @${process.env.TWITTER_USERNAME}`);

      // 启动推文队列处理
      this.processTweetQueue();

      // 开始追踪
      await this.startTracking();
    } catch (error) {
      console.error('❌ 初始化失败:', error);
      throw error;
    }
  }

  private async processMedia(tweet: Tweet, username: string): Promise<MediaItem[]> {
    const media: MediaItem[] = [];
    
    if (!tweet.photos || tweet.photos.length === 0) {
      return media;
    }

    console.log(`\n📸 检测到 ${tweet.photos.length} 个媒体文件`);
    const mediaDir = path.join(this.historyDir, 'media');

    for (const item of tweet.photos) {
      try {
        if (!item.url) {
          console.warn('\n⚠️ 跳过：媒体文件缺少 URL');
          continue;
        }

        const response = await customFetch(item.url);
        if (!response.ok) {
          throw new Error(`下载失败: ${response.status} ${response.statusText}`);
        }

        const buffer = Buffer.from(await response.arrayBuffer());
        const urlObj = new URL(item.url);
        const ext = path.extname(urlObj.pathname).toLowerCase();

        // 检查文件类型
        const imageTypes: { [key: string]: string } = {
          '.jpg': 'image/jpeg',
          '.jpeg': 'image/jpeg',
          '.png': 'image/png',
          '.gif': 'image/gif',
          '.webp': 'image/webp'
        };

        const videoTypes: { [key: string]: string } = {
          '.mp4': 'video/mp4',
          '.mov': 'video/quicktime',
          '.avi': 'video/x-msvideo',
          '.webm': 'video/webm'
        };

        let mimeType = imageTypes[ext] || videoTypes[ext];

        if (!mimeType) {
          console.warn(`\n⚠️ 跳过：不支持的文件类型 ${ext}`);
          continue;
        }

        // 生成文件名
        const timestamp = Date.now();
        const filename = path.join(mediaDir, `${username}_${timestamp}${ext}`);

        // 保存文件
        fs.writeFileSync(filename, buffer);

        // 添加到媒体列表
        media.push({
          type: mimeType,
          data: buffer,
          url: item.url,
          path: filename
        });

        console.log(`✅ 已保存: ${path.basename(filename)}`);

      } catch (error) {
        console.error(`❌ 下载失败:`, error);
      }
    }

    return media;
  }

  private removeUrls(text: string): string {
    // 匹配URL的正则表达式
    const urlRegex = /(https?:\/\/[^\s]+)/g;
    
    // 移除所有URL和"Address:"行
    return text
      .replace(/Address:[\s\S]*$/, '') // 移除 Address: 及其后面的所有内容
      .replace(urlRegex, '')
      .replace(/\s+/g, ' ')
      .trim();
  }

  private cleanAIOutput(text: string): string {
    // 移除引号（包括中英文引号）
    text = text.replace(/["""]/g, '');
    
    // 移除字符计数提示
    text = text.replace(/\s*\(\d+\s*characters?\)/gi, '');
    
    // 清理多余空格
    text = text.replace(/\s+/g, ' ').trim();
    
    return text;
  }

  private truncateText(text: string): string {
    // 如果文本包含链接，先移除链接
    const textWithoutUrls = this.removeUrls(text);
    // 截断到277个字符并添加省略号
    return textWithoutUrls.slice(0, 277) + '...';
  }

  private async optimizeTweetContent(text: string, tweetId?: string): Promise<string> {
    try {
      // 如果原文已经符合要求，直接返回
      if (text.length <= 280) {
        return text;
      }

      // 检查重试次数
      if (tweetId) {
        const retryCount = this.tweetRetryCount.get(tweetId) || 0;
        if (retryCount >= 2) {
          console.log('⚠️ 已尝试优化2次，使用截断方法');
          // 重置计数器
          this.tweetRetryCount.delete(tweetId);
          return this.truncateText(text);
        }
        this.tweetRetryCount.set(tweetId, retryCount + 1);
      }

      // 只有当文本超过280字符时才移除链接
      const textWithoutUrls = this.removeUrls(text);
      console.log('🔗 已移除链接和地址');
      console.log('├─ 原文长度:', text.length);
      console.log('└─ 处理后长度:', textWithoutUrls.length);

      // 如果移除链接后的文本符合要求，直接返回
      if (textWithoutUrls.length <= 280) {
        return textWithoutUrls;
      }

      // 验证 API Key
      if (!process.env.GLHF_API_KEY) {
        throw new Error('缺少 GLHF_API_KEY 环境变量');
      }
      console.log('🔑 使用 GLHF API Key:', process.env.GLHF_API_KEY.substring(0, 10) + '...');

      const client = new OpenAI({
        apiKey: process.env.GLHF_API_KEY,
        baseURL: 'https://glhf.chat/api/openai/v1',
      });

      const systemPrompt = `你是一个专业的推特内容优化助手。你的任务是将以下这段具体的文本压缩到280字符以内，但要尽量保持原文的完整性：

"${textWithoutUrls}"

关键要求：
1. 字符限制：
   - 必须控制在280字符以内
   - 但不要过度压缩，如果优化后字符数远小于280，应该保留更多细节
   - 建议优化后的长度在230-270字符之间

2. 内容保留原则：
   - 保留所有价格、数量、时间等具体数字
   - 保留所有技术指标和市场信号
   - 保留趋势描述和关键分析
   - 保持专业术语的准确性

3. 适度简化策略：
   - Moving Average 可以写作 MA
   - "above" 可以用 ">"
   - "below" 可以用 "<"
   - "and" 可以用 "&"
   - 但不要过度使用符号，保持可读性

4. 格式要求：
   - 不使用引号
   - 不要添加字符计数
   - 不使用省略号
   - 保持语言流畅自然`;

      const userPrompt = `请优化这段文本，使其不超过280字符，但要尽量保持完整和自然。当前长度：${textWithoutUrls.length}字符。记住：不要过度压缩，建议优化后在230-270字符之间。`;

      console.log('📝 发送优化请求...');
      const stream = await client.chat.completions.create({
        model: "hf:mistralai/Mistral-7B-Instruct-v0.3",
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: userPrompt }
        ],
        temperature: 0.7,
        stream: true,
      });

      let optimizedText = '';
      console.log('📥 接收AI响应...');
      for await (const chunk of stream) {
        const content = chunk.choices[0]?.delta?.content || '';
        optimizedText += content;
        process.stdout.write(content);
      }
      console.log('\n✨ AI响应完成');
      
      optimizedText = this.cleanAIOutput(optimizedText);
      
      // 如果优化后仍然过长，再次优化
      if (optimizedText.length > 280) {
        console.log(`\n⚠️ AI首次优化结果仍然过长 (${optimizedText.length}字符)，尝试二次优化...`);
        
        const secondPrompt = `当前文本长度${optimizedText.length}字符，必须进一步压缩到280字符以内。这是原文：\n\n${optimizedText}\n\n要求：
1. 必须压缩到280字符以内
2. 使用更多技术缩写
3. 删除所有非必要词语
4. 保留核心信息完整`;
        
        console.log('📝 发送二次优化请求...');
        const secondStream = await client.chat.completions.create({
          model: "hf:mistralai/Mistral-7B-Instruct-v0.3",
          messages: [
            { role: "system", content: systemPrompt },
            { role: "user", content: secondPrompt }
          ],
          temperature: 0.5,
          stream: true,
        });

        let finalText = '';
        console.log('📥 接收AI二次响应...');
        for await (const chunk of secondStream) {
          const content = chunk.choices[0]?.delta?.content || '';
          finalText += content;
          process.stdout.write(content);
        }
        console.log('\n✨ AI二次响应完成');
        
        finalText = this.cleanAIOutput(finalText);
        
        // 如果两次AI优化都失败，再尝试一次极简优化
        if (finalText.length > 280) {
          console.log(`\n⚠️ 二次优化后仍然过长 (${finalText.length}字符)，尝试极简优化...`);
          
          const finalPrompt = `这是最后一次尝试，必须将文本压缩到280字符以内。当前长度：${finalText.length}字符。\n\n${finalText}\n\n要求：
1. 使用最极简的表达
2. 只保留最核心的信息
3. 大量使用符号和缩写
4. 必须控制在280字符以内`;
          
          console.log('📝 发送极简优化请求...');
          const finalStream = await client.chat.completions.create({
            model: "hf:mistralai/Mistral-7B-Instruct-v0.3",
            messages: [
              { role: "system", content: systemPrompt },
              { role: "user", content: finalPrompt }
            ],
            temperature: 0.3,
            stream: true,
          });

          let ultraCompactText = '';
          console.log('📥 接收极简优化响应...');
          for await (const chunk of finalStream) {
            const content = chunk.choices[0]?.delta?.content || '';
            ultraCompactText += content;
            process.stdout.write(content);
          }
          console.log('\n✨ 极简优化完成');
          
          ultraCompactText = this.cleanAIOutput(ultraCompactText);
          
          if (ultraCompactText.length > 280) {
            throw new Error(`三次优化后仍超过限制 (${ultraCompactText.length}字符)`);
          }
          
          return ultraCompactText;
        }
        
        return finalText;
      }
      
      return optimizedText;
    } catch (error) {
      throw error;
    }
  }

  private async sendTweetDirectly(text: string, media: MediaItem[]) {
    try {
      // 生成唯一的推文ID用于跟踪重试次数
      const tweetId = crypto.randomBytes(16).toString('hex');
      
      // 优化推文内容
      const optimizedText = await this.optimizeTweetContent(text, tweetId);

      // 准备媒体数据
      const mediaData = media.map(item => ({
        data: item.data,
        mediaType: item.type
      }));

      console.log('\n📤 准备发送推文:');
      console.log('├─ 原文长度:', text.length);
      console.log('├─ 优化后长度:', optimizedText.length);
      if (text !== optimizedText) {
        console.log('├─ 原文:', text);
        console.log('├─ 优化后:', optimizedText);
      }
      console.log('├─ 媒体数量:', mediaData.length);
      if (mediaData.length > 0) {
        console.log('└─ 媒体类型:', mediaData.map(m => m.mediaType).join(', '));
      }

      // 再次验证登录状态
      const isLoggedIn = await (this.scraper as any).isLoggedIn();
      if (!isLoggedIn) {
        throw new Error('发送前检查：未登录状态');
      }
      
      // 使用 agent-twitter-client 发送推文
      if (mediaData.length > 0) {
        console.log('\n📤 正在上传媒体文件...');
        await (this.scraper as any).sendTweet(optimizedText, undefined, mediaData);
        console.log('✨ 带媒体的推文发送成功!');
      } else {
        await (this.scraper as any).sendTweet(optimizedText);
        console.log('✨ 推文发送成功!');
      }

      // 更新统计信息
      this.tweetStats.sent++;
      this.displayStats();

      // 清除重试计数器
      if (tweetId) {
        this.tweetRetryCount.delete(tweetId);
      }

    } catch (error) {
      throw error;
    }
  }

  private displayStats() {
    console.log('\n📊 统计');
    console.log('├─────────────────────────');
    console.log(`│ 推文: ${this.tweetStats.total}`);
    console.log(`│ 媒体: ${this.tweetStats.withMedia}`);
    console.log(`│ 队列: ${this.tweetQueue.length}`);
    console.log(`│ 发送: ${this.tweetStats.sent}`);
    console.log('└─────────────────────────\n');
  }

  private async checkNewTweets(username: string) {
    try {
      const latestTweet = await this.scraper.getLatestTweet(username) as Tweet | null;
      
      if (!latestTweet) {
        return;
      }

      const lastKnownTweetId = this.lastTweetIds.get(username);
      
      // 如果是新推文
      if (!lastKnownTweetId || latestTweet.id !== lastKnownTweetId) {
        this.tweetStats.total++;
        console.log('\n🔔 检测到新推文');

        const media = await this.processMedia(latestTweet, username);
        if (media.length > 0) {
          this.tweetStats.withMedia++;
        }

        // 显示推文内容
        this.displayTweet(username, latestTweet, media);

        // 更新最后一条推文ID
        this.lastTweetIds.set(username, latestTweet.id);

        // 如果配置了自动发送，则加入发送队列
        if (this.autoSendTweets) {
          this.tweetQueue.push({
            text: latestTweet.text,
            media: media
          });
          console.log('\n📤 已加入发送队列');
        }

        // 显示统计信息
        this.displayStats();
      }
    } catch (error) {
      console.error(`\n❌ 检查推文出错:`, error);
    }
  }

  private displayTweet(username: string, tweet: Tweet, media: MediaItem[]) {
    console.log('\n┌─────────────────────────────────────────────────┐');
    console.log(`│ 📱 @${username}`);
    console.log(`│ 🕒 ${this.formatDate(new Date(tweet.timeParsed))}`);
    console.log('├─────────────────────────────────────────────────┤');
    
    // 推文内容 - 处理多行文本
    const lines = tweet.text.split('\n');
    for (const line of lines) {
      if (line.trim()) {
        // 将长行分割成多行，每行最多50个字符
        const wrappedLines = line.match(/.{1,50}(\s|$)/g) || [line];
        for (const wrappedLine of wrappedLines) {
          console.log(`│ ${wrappedLine.trim()}`);
        }
      } else {
        console.log('│');
      }
    }

    // 如果有图片，显示图片信息
    if (media.length > 0) {
      console.log('├─────────────────────────────────────────────────┤');
      for (const item of media) {
        const filename = item.path ? path.basename(item.path) : '下载失败';
        console.log(`│ 📸 ${filename}`);
      }
    }
    
    // 底部显示互动数据
    console.log('├─────────────────────────────────────────────────┤');
    console.log(`│ ❤️  ${tweet.likes}  🔄 ${tweet.retweets}  💬 ${tweet.replies}`);
    console.log('└─────────────────────────────────────────────────┘');
  }

  private formatDate(date: Date): string {
    const now = new Date();
    const diff = now.getTime() - date.getTime();
    const seconds = Math.floor(diff / 1000);
    const minutes = Math.floor(seconds / 60);
    const hours = Math.floor(minutes / 60);
    const days = Math.floor(hours / 24);

    if (days > 0) {
      return `${days}天前`;
    } else if (hours > 0) {
      return `${hours}小时前`;
    } else if (minutes > 0) {
      return `${minutes}分钟前`;
    } else if (seconds > 0) {
      return `${seconds}秒前`;
    } else {
      return '刚刚';
    }
  }

  private async processTweetQueue() {
    console.log(`\n⏰ 首次推文将在 ${new Date(this.lastSendTime + this.tweetInterval).toLocaleTimeString()} 发送`);
    
    while (true) {
      try {
        if (this.tweetQueue.length > 0) {
          const now = Date.now();
          if (now - this.lastSendTime >= this.tweetInterval) {
            // 只保留最新的推文，清空其他推文
            const latestTweet = this.tweetQueue[this.tweetQueue.length - 1];
            this.tweetQueue = []; // 清空队列
            
            try {
              // 验证登录状态
              const isLoggedIn = await (this.scraper as any).isLoggedIn();
              if (!isLoggedIn) {
                console.log('\n⚠️ 检测到未登录状态，尝试重新登录...');
                await (this.scraper as any).login(
                  process.env.TWITTER_USERNAME!,
                  process.env.TWITTER_PASSWORD!,
                  process.env.TWITTER_EMAIL
                );
              }

              console.log('\n📤 正在发送最新推文...');
              await this.sendTweetDirectly(latestTweet.text, latestTweet.media);
              this.lastSendTime = now;
              console.log(`\n⏰ 下一条推文将在 ${new Date(now + this.tweetInterval).toLocaleTimeString()} 发送`);
            } catch (error) {
              let errorMessage = '发送失败';
              if (error instanceof Error) {
                errorMessage = error.message;
              }
              console.error(`\n❌ 发送失败: ${errorMessage}`);
              
              // 如果发送失败，将最新推文重新加入队列
              this.tweetQueue.push(latestTweet);
              // 增加延迟，避免立即重试
              await new Promise(resolve => setTimeout(resolve, 5000));
            }
          } else {
            const timeLeft = this.tweetInterval - (now - this.lastSendTime);
            const minutes = Math.floor(timeLeft / 60000);
            const seconds = Math.floor((timeLeft % 60000) / 1000);
            process.stdout.write(`\r⏳ 距离发送下一条推文: ${minutes}分 ${seconds}秒                    `);
          }
        }
      } catch (error) {
        console.error('\n❌ 处理推文队列时出错:', error);
      }
      await new Promise(resolve => setTimeout(resolve, 1000)); // 每秒检查一次队列
    }
  }

  async startTracking() {
    if (this.isTracking) {
      console.log('\n⚠️ 已在追踪中');
      return;
    }

    this.isTracking = true;
    console.log('\n🚀 开始追踪\n');

    const checkTweets = async () => {
      for (const username of this.trackedUsers) {
        await this.checkNewTweets(username);
      }
      console.log(`\n⏳ 下次检查: ${new Date(Date.now() + this.checkInterval).toLocaleTimeString()}`);
    };

    // 立即执行一次检查
    await checkTweets();

    // 设置定时检查
    this.trackingInterval = setInterval(checkTweets, this.checkInterval);
  }

  stopTracking() {
    if (!this.isTracking) {
      console.log('\n⚠️ 没有正在进行的追踪...');
      return;
    }

    if (this.trackingInterval) {
      clearInterval(this.trackingInterval);
      this.trackingInterval = null;
    }
    this.isTracking = false;
    console.log('\n🛑 停止追踪推文');
  }
}
