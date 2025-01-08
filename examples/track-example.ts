import { TwitterTracker } from '../src/twitter-tracker';
import * as dotenv from 'dotenv';

// 加载环境变量
dotenv.config();

async function main() {
  // 创建 Twitter 追踪器
  const tracker = new TwitterTracker({
    username: process.env.TWITTER_USERNAME!,
    password: process.env.TWITTER_PASSWORD!,
    trackedUsers: [
      'lookonchain',
      'theblock_',
      'thomas_fahrer',
      'coindeskmarkets',
      'cointelegraph',
    ],
    checkInterval: 14400000, // 4小时检查一次
    historyDir: './twitter-history',
    autoSendTweets: true,
    tweetInterval: 28800000 // 8小时发送一次
  });

  try {
    // 初始化（登录 Twitter）
    await tracker.initialize();
    
    // 开始追踪
    await tracker.startTracking();
  } catch (error) {
    console.error('Error:', error);
  }
}

// 运行主程序
main().catch(console.error);
