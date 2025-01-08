const fs = require('fs');
const path = require('path');
const { Scraper } = require('agent-twitter-client');
const Anthropic = require('@anthropic-ai/sdk');
const readline = require('readline');
const { fetch } = require('undici');
require('dotenv').config({ path: '.env' });

const CONFIG = require('./config-send.js')

class AITwitterBot {
    constructor() {
        // 初始化 Twitter 客户端
        this.scraper = new Scraper();
        
        this.topics = CONFIG.botConfig.topics;
        this.currentTopicIndex = CONFIG.botConfig.currentTopicIndex;
        this.INTERVAL = CONFIG.botConfig.INTERVAL;
        this.nextTweetTime = CONFIG.botConfig.nextTweetTime;
        this.countdownInterval = CONFIG.botConfig.countdownInterval;
        
        // API 配置
        this.apiChoice = CONFIG.apiConfig.apiChoice;
        this.claude = null;
        
        // Ollama 配置
        this.ollamaEndpoint = CONFIG.apiConfig.ollamaEndpoint;
        this.modelName = CONFIG.apiConfig.modelName;
        
        // 添加 GLHF 配置
        this.GLHF_CONFIG = CONFIG.apiConfig.GLHF_CONFIG;
        
        // 登录重试计数器
        this.loginAttempts = CONFIG.botConfig.loginAttempts;
    }

    async initialize() {
        console.log('\n🤖 机器人配置:', {
            API: this.apiChoice.toUpperCase(),
            Project: 'TitanArc - Construction Materials Innovation'
        });
        
        // API 选择界面
        const rl = readline.createInterface({
            input: process.stdin,
            output: process.stdout
        });

        console.log('\n🤖 请选择要使用的 API:');
        console.log('1. Claude API (更智能，需要 API 密钥)');
        console.log('2. Ollama API (本地运行，免费)');
        console.log('3. GLHF API (在线服务，免费)');

        const answer = await new Promise(resolve => {
            rl.question('请输入选项 (1, 2 或 3): ', resolve);
        });
        rl.close();

        this.apiChoice = answer.trim() === '1' ? 'claude' : 
                        answer.trim() === '2' ? 'ollama' : 'glhf';

        // 初始化选择的 API
        await this.initializeAPI();
        
        // Twitter 登录
        await this.loginToTwitter();
    }

    async initializeAPI() {
        try {
            switch(this.apiChoice) {
                case 'claude':
                    await this.initializeClaude();
                    break;
                case 'ollama':
                    await this.initializeOllama();
                    break;
                case 'glhf':
                    await this.initializeGLHF();
                    break;
            }
        } catch (error) {
            console.error(`❌ ${this.apiChoice.toUpperCase()} API 初始化失败:`, error.message);
            process.exit(1);
        }
    }

    async loginToTwitter() {
        while (this.loginAttempts < CONFIG.twitterConfig.LOGIN_RETRY_ATTEMPTS) {
            try {
                console.log('🔑 正在登录 Twitter...');
                
                const loginPromise = this.scraper.login(
                    CONFIG.twitterConfig.TWITTER_USERNAME, 
                    CONFIG.twitterConfig.TWITTER_PASSWORD, 
                    CONFIG.twitterConfig.TWITTER_EMAIL
                );
                
                const timeoutPromise = new Promise((_, reject) => 
                    setTimeout(() => reject(new Error('登录超时')), CONFIG.twitterConfig.LOGIN_TIMEOUT)
                );
                
                await Promise.race([loginPromise, timeoutPromise]);
                console.log('✅ 登录请求已发送');
                
                const isLoggedIn = await this.scraper.isLoggedIn();
                if (!isLoggedIn) {
                    throw new Error('登录验证失败');
                }
                
                console.log('🎉 登录成功！');
                
                // 获取并保存 cookies
                const cookies = await this.scraper.getCookies();
                console.log('🍪 已获取新的 cookies');
                return;
                
            } catch (error) {
                this.loginAttempts++;
                console.error(`❌ 登录失败 (尝试 ${this.loginAttempts}/${CONFIG.twitterConfig.LOGIN_RETRY_ATTEMPTS}):`, error.message);
                
                if (this.loginAttempts >= CONFIG.twitterConfig.LOGIN_RETRY_ATTEMPTS) {
                    console.error('达到最大重试次数，退出程序');
                    process.exit(1);
                }
                
                console.log(`⏳ ${CONFIG.twitterConfig.LOGIN_RETRY_DELAY/1000}秒后重试...`);
                await new Promise(resolve => setTimeout(resolve, CONFIG.twitterConfig.LOGIN_RETRY_DELAY));
            }
        }
    }

    async initializeClaude() {
        // 直接设置 API 密钥
        const apiKey = CONFIG.apiConfig.claudeAPIKey;

        try {
            this.claude = new Anthropic({
                apiKey: apiKey,
            });
            
            // 测试 API 连接
            await this.claude.messages.create({
                model: 'claude-3-opus-20240229',
                max_tokens: 10,
                messages: [{
                    role: 'user',
                    content: 'Test connection'
                }]
            });
            
            console.log('✅ Claude API 连接测试成功');
        } catch (error) {
            console.error('❌ Claude API 连接失败:', error.message);
            console.log('API 密钥可能已过期或无效，请更新密钥');
            process.exit(1);
        }
    }

    async initializeOllama() {
        console.log('✅ Ollama API 已配置');
        
        // 测试 Ollama 连接
        try {
            const response = await fetch(`${this.ollamaEndpoint}/api/tags`);
            if (!response.ok) {
                throw new Error(`HTTP ${response.status}`);
            }
            console.log('✅ Ollama API 连接测试成功');
        } catch (error) {
            console.error('❌ Ollama API 连接失败:', error.message);
            console.log('请确保 Ollama 服务正在运行');
            process.exit(1);
        }
    }

    async initializeGLHF() {
        console.log('✅ GLHF API 已配置');
        
        // 测试 GLHF API 连接
        try {
            const response = await fetch(`${this.GLHF_CONFIG.API_BASE}/models`, {
                method: 'GET',
                headers: {
                    'Authorization': `Bearer ${this.GLHF_CONFIG.API_KEY}`,
                    'Content-Type': 'application/json'
                }
            });
            
            if (!response.ok) {
                throw new Error(`HTTP ${response.status}`);
            }
            console.log('✅ GLHF API 连接测试成功');
        } catch (error) {
            console.error('❌ GLHF API 连接失败:', error.message);
            throw error;
        }
    }

    async generateResponse(prompt) {
        try {
            console.log('🤔 正在生成回应...');
            
            if (this.apiChoice === 'claude') {
                const systemContext = `你是一个专业的建筑和材料行业专家。请用中文回复。
你的回应应该:
- 基于真实的建筑行业趋势
- 突出铝合金和钢结构的优势
- 专业且富有营销效果
- 每次风格都有所不同
- 包含行动号召

主要产品:
- 铝合金结构系统
- 钢结构解决方案
- 模块化建筑系统
- 智能化施工方案`;

                const response = await this.claude.messages.create({
                    model: 'claude-3-opus-20240229',
                    max_tokens: 200,
                    messages: [{
                        role: 'user',
                        content: `${systemContext}\n\n${prompt}`
                    }],
                    temperature: 0.7
                });
                
                console.log('✨ 回应生成成功');
                return response.content[0].text;
            } else if (this.apiChoice === 'glhf') {
                const response = await fetch(`${this.GLHF_CONFIG.API_BASE}/chat/completions`, {
                    method: 'POST',
                    headers: {
                        'Authorization': `Bearer ${this.GLHF_CONFIG.API_KEY}`,
                        'Content-Type': 'application/json'
                    },
                    body: JSON.stringify({
                        model: this.GLHF_CONFIG.MODEL,
                        messages: [{
                            role: 'system',
                            content: `你是一个专业的建筑和材料行业专家。请用中文回复。
你的回应应该:
- 基于真实的建筑行业趋势
- 突出铝合金和钢结构的优势
- 专业且富有营销效果
- 每次风格都有所不同
- 包含行动号召

主要产品:
- 铝合金结构系统
- 钢结构解决方案
- 模块化建筑系统
- 智能化施工方案`
                        }, {
                            role: 'user',
                            content: prompt
                        }],
                        temperature: 0.7,
                        max_tokens: 200
                    })
                });

                if (!response.ok) {
                    throw new Error(`HTTP 错误! 状态码: ${response.status}`);
                }

                const data = await response.json();
                console.log('✨ 回应生成成功');
                return data.choices[0].message.content;
            }
        } catch (error) {
            console.error('❌ 生成失败:', error.message);
            throw error;
        }
    }

    async generateTopicalTweet() {
        // 从预定义的主题中随机选择
        const topics = CONFIG.botConfig.topics;
        const topic = topics[Math.floor(Math.random() * topics.length)];

        const now = new Date();
        console.log(`\n🎯 生成推文主题: "${topic}" [${now.toLocaleTimeString()}]`);
        
        try {
            // 为每个主题定义特定的提示词和标签
            const topicConfig = CONFIG.topicConfig;
            const promptConfig = CONFIG.botPromptConfig;

            const config = topicConfig[topic];
            const randomFocus = config.focus[Math.floor(Math.random() * config.focus.length)];
            const maxMainLength = promptConfig.tweetGenerationRules.maxLength;

            const systemContext = promptConfig.englishSystemContext;

            const prompt = `${systemContext}

Write a concise tweet about ${randomFocus} in ${topic}. Requirements:
1. MUST be under ${maxMainLength} characters
2. Share ONE specific, recent development in construction materials
3. Mention a company or research project if possible
4. NO hashtags (they will be added automatically)
5. NO emojis or special characters
6. NO punctuation at the end
7. Be EXTREMELY brief and to the point

Focus on RECENT developments (last 3 months) that would interest construction professionals.`;

            let response = await this.generateResponse(prompt);
            
            if (response) {
                // 清理并格式化响应
                response = response
                    .replace(/[""]/g, '') // 移除引号
                    .replace(/[!?.,]+$/, '') // 移除末尾标点
                    .replace(/\s+/g, ' ') // 规范化空格
                    .trim();
                
                // 强制截断到最大长度，同时保留空间给 hashtags
                const tagsLength = config.tags.length + 1; // +1 for the space
                const availableLength = maxMainLength - tagsLength;
                
                if (response.length > availableLength) {
                    response = response.substring(0, availableLength).trim();
                }
                
                // 添加 hashtags
                const finalTweet = `${response} ${config.tags}`;
                
                const tweetLength = finalTweet.length;
                console.log(`📝 生成的推文 [${tweetLength}字符]:`);
                console.log(finalTweet);
                
                if (tweetLength > 280) {
                    throw new Error('推文超过280字符限制');
                }
                
                // 随机选择图片
                const mediaData = this.selectRandomImage();
                
                console.log('🚀 正在发送推文...');
                if (mediaData) {
                    // 如果找到图片，发送带图片的推文
                    await this.scraper.sendTweet(finalTweet, undefined, [mediaData]);
                    console.log('✨ 带图片的推文发送成功!');
                } else {
                    // 如果没有找到图片，发送普通推文
                    await this.scraper.sendTweet(finalTweet);
                    console.log('✨ 推文发送成功!');
                }
                
                console.log(`[${now.toLocaleTimeString()}]`);

                // 更新下一次发送时间
                this.nextTweetTime = Date.now() + this.INTERVAL;
                const nextTime = new Date(this.nextTweetTime);
                console.log(`⏰ 下一条推文将在 ${nextTime.toLocaleTimeString()} 发送`);
                this.startCountdown();
                
                return {
                    success: true,
                    message: '✅ 推文操作成功完成',
                    tweet: finalTweet
                };
            }
        } catch (error) {
            console.error('❌ 推文生成失败:', error.message);
            throw error;
        }
    }

    startCountdown() {
        if (this.countdownInterval) {
            clearInterval(this.countdownInterval);
        }
        
        this.nextTweetTime = Date.now() + this.INTERVAL;
        
        this.countdownInterval = setInterval(() => {
            const now = Date.now();
            const timeLeft = this.nextTweetTime - now;
            
            if (timeLeft <= 0) {
                clearInterval(this.countdownInterval);
                return;
            }
            
            const minutes = Math.floor(timeLeft / 60000);
            const seconds = Math.floor((timeLeft % 60000) / 1000);
            process.stdout.write(`\r⏳ 距离下一条推文: ${minutes}分 ${seconds}秒`);
        }, 1000);
    }

    cleanup() {
        if (this.countdownInterval) {
            clearInterval(this.countdownInterval);
        }
    }

    // 随机选择图片
    selectRandomImage() {
        const imagesDir = path.join(__dirname, 'images');
        
        try {
            // 读取目录中的所有文件
            const files = fs.readdirSync(imagesDir);
            
            // 过滤出图片文件
            const imageFiles = files.filter(file => {
                const ext = path.extname(file).toLowerCase();
                return ['.jpg', '.jpeg', '.png', '.gif'].includes(ext);
            });
            
            // 如果没有图片，返回 null
            if (imageFiles.length === 0) {
                console.warn('❌ 没有找到图片文件');
                return null;
            }
            
            // 随机选择一张图片
            const randomImageName = imageFiles[Math.floor(Math.random() * imageFiles.length)];
            const imagePath = path.join(imagesDir, randomImageName);
            
            // 读取图片文件
            const imageBuffer = fs.readFileSync(imagePath);
            
            // 确定 MIME 类型
            const ext = path.extname(randomImageName).toLowerCase();
            const mimeTypes = {
                '.jpg': 'image/jpeg',
                '.jpeg': 'image/jpeg',
                '.png': 'image/png',
                '.gif': 'image/gif'
            };
            
            return {
                data: imageBuffer,
                mediaType: mimeTypes[ext]
            };
        } catch (error) {
            console.error('❌ 选择图片时出错:', error.message);
            return null;
        }
    }
}

// 主程序
async function main() {
    const bot = new AITwitterBot();
    
    process.on('SIGINT', () => {
        console.log('\n👋 正在关闭机器人...');
        bot.cleanup();
        process.exit(0);
    });

    try {
        await bot.initialize();
        console.log('\n🚀 开始发送第一条推文...');
        const result = await bot.generateTopicalTweet();
        console.log(result.message);
        
        setInterval(async () => {
            const result = await bot.generateTopicalTweet();
            console.log(result.message);
        }, bot.INTERVAL);

    } catch (error) {
        console.error('❌ 程序错误:', error.message);
        bot.cleanup();
        process.exit(1);
    }
}

if (require.main === module) {
    main().catch(error => {
        console.error('❌ 致命错误:', error.message);
        process.exit(1);
    });
}
