const CONFIG = {
    projectName: 'TitanArc',
    projectTags: '#Construction, #BuildingMaterials, #SteelStructures, #AluminiumStructures',
    
    // 机器人运行参数
    botConfig: {
        topics: [
            'Construction Materials',
            'Building Materials', 
            'Sustainable Construction',
            'Steel Structures',
            'Aluminium Solutions'
        ],
        currentTopicIndex: 0,
        INTERVAL: 5 * 60 * 1000, // 5分钟
        nextTweetTime: null,
        countdownInterval: null,
        loginAttempts: 0
    },

    // 机器人提示词配置
    botPromptConfig: {
        mainProductIntro: `主要产品:
- 铝合金结构系统
- 钢结构解决方案
- 模块化建筑系统
- 智能化施工方案`,

        chineseSystemContext: `你是一个专业的建筑和材料行业专家。请用中文回复。
你的回应应该:
- 基于真实的建筑行业趋势
- 突出铝合金和钢结构的优势
- 专业且富有营销效果
- 每次风格都有所不同
- 包含行动号召`,

        englishSystemContext: `You are a senior expert in construction materials and structural engineering, representing TitanArc. Your tweets should be:
- Based on REAL and RECENT (within last 3 months) developments in construction materials
- Specific and factual, mentioning actual companies, research institutions, or innovative projects
- Professional and authoritative
- Focused on technological advancements, sustainability, and material science
- Highlight practical implications for the construction industry`,

        tweetGenerationRules: {
            maxLength: 280,
            requirements: [
                "MUST be under 280 characters",
                "Share ONE specific, recent, and verifiable development in construction materials",
                "Mention actual companies, research projects, or technological breakthroughs where relevant",
                "NO hashtags (they will be added automatically)",
                "NO emojis or special characters",
                "NO punctuation at the end"
            ],
            focusArea: "RECENT developments (last 3 months) that would interest construction professionals, engineers, and architects"
        }
    },

    // API 配置
    apiConfig: {
        apiChoice: 'ollama', // 默认使用 ollama
        ollamaEndpoint: 'http://localhost:11434',
        modelName: 'meta-llama/Llama-3.2-405B-Instruct',
        
        // GLHF API 配置
        GLHF_CONFIG: {
            API_BASE: "https://glhf.chat/api/openai/v1",
            API_KEY: "glhf_85f3ed62c8cdbfa1f7b044511cc4c6cd",
            MODEL: "hf:meta-llama/Llama-3.1-405B-Instruct"
        },

        // Claude API 配置
        claudeAPIKey: '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'
    },

    // Twitter 账号配置
    twitterConfig: {
        TWITTER_USERNAME: 'titanarc_cn',
        TWITTER_PASSWORD: 'Titan_888',
        TWITTER_EMAIL: 'titanarc88@gmail.com',
        TWITTER_COOKIES: JSON.parse('[{"key":"auth_token","value":"6ce290bec2746fdc82dccd4817cf661eddf3fad3","domain":".twitter.com"},{"key":"ct0","value":"72e6bff32506e267465d93c6150bd8c442d0d48e2222735a3350a28500123c368497ddc7edb2b244d6d09de65c4f0ccab6bfa6938801751eff5a67bb52a3eb09f8bfa9220710d47f8c8a8101c069c5f1","domain":".twitter.com"},{"key":"guest_id","value":"v1%3A173495770929326414","domain":".twitter.com"}]'),

        // 登录配置
        LOGIN_TIMEOUT: 30000, // 登录超时时间（毫秒）
        LOGIN_RETRY_ATTEMPTS: 3, // 登录重试次数
        LOGIN_RETRY_DELAY: 60000 // 登录重试延迟（毫秒）
    },

    topicConfig: {
        'Construction Materials': {
            tags: '#Construction #BuildingMaterials',
            focus: [
                'advanced construction materials',
                'material innovation',
                'sustainable building solutions',
                'structural material trends',
                'construction material performance'
            ]
        },
        'Building Materials': {
            tags: '#BuildingMaterials #Construction',
            focus: [
                'modern building material technologies',
                'material durability',
                'eco-friendly construction materials',
                'material cost-effectiveness',
                'building material research'
            ]
        },
        'Sustainable Construction': {
            tags: '#SustainableConstruction #GreenBuilding',
            focus: [
                'green building practices',
                'sustainable material selection',
                'energy-efficient construction',
                'carbon-neutral building solutions',
                'environmental impact of construction'
            ]
        },
        'Steel Structures': {
            tags: '#SteelStructures #Construction',
            focus: [
                'steel structure design',
                'advanced steel fabrication',
                'steel building innovations',
                'structural steel applications',
                'steel construction techniques'
            ]
        },
        'Aluminium Solutions': {
            tags: '#AluminiumStructures #BuildingMaterials',
            focus: [
                'aluminium in construction',
                'lightweight structural solutions',
                'aluminium alloy innovations',
                'architectural aluminium applications',
                'aluminium material advantages'
            ]
        }
    }
};

module.exports = CONFIG;