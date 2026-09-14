/**
 * 规则回退用的话题词典。LLM 不可用时，用关键词命中做兴趣提取与争议检测。
 * 同时也是「换个角度看」的兜底：对已知争议话题给出正反方检索词。
 */

export interface LexiconEntry {
  name: string;
  keywords: string[];
  searchQueries: string[];
  controversial: boolean;
  question?: string;
  pro?: { label: string; query: string; cues: string[] };
  con?: { label: string; query: string; cues: string[] };
}

export const LEXICON: LexiconEntry[] = [
  {
    name: "主动回忆与重复阅读",
    keywords: ["主动回忆", "提取练习", "间隔重复", "反复阅读", "重复阅读", "active recall"],
    searchQueries: ["主动回忆 重复阅读 学习方法", "提取练习 间隔复习 适用条件"],
    controversial: false,
  },
  {
    name: "考研 vs 就业",
    keywords: ["考研", "读研", "研究生", "硕士", "秋招", "直接工作", "先工作", "学历贬值"],
    searchQueries: ["考研还是直接工作", "考研 vs 就业"],
    controversial: true,
    question: "应届生应该先考研还是先工作？",
    pro: { label: "先考研", query: "为什么建议考研而不是先工作", cues: ["想考", "倾向于考研", "考研的好处", "支持考研", "更稳"] },
    con: { label: "先工作", query: "为什么建议先工作再考研", cues: ["先工作", "直接工作", "性价比在下降", "工作两年"] },
  },
  {
    name: "Python 数据分析",
    keywords: ["pandas", "numpy", "数据分析", "matplotlib", "seaborn", "groupby", "数据集", "python"],
    searchQueries: ["Python 数据分析 学习路线", "pandas 入门 实战项目"],
    controversial: false,
  },
  {
    name: "实习求职",
    keywords: ["实习", "简历", "面试", "投递", "sql", "窗口函数", "offer"],
    searchQueries: ["数据分析实习 简历", "SQL 窗口函数 面试"],
    controversial: false,
  },
  {
    name: "租房",
    keywords: ["租房", "押金", "合同", "中介", "房东", "押一付三", "短租"],
    searchQueries: ["第一次租房 合同 注意事项"],
    controversial: false,
  },
  {
    name: "减脂健身",
    keywords: ["减脂", "健身", "力量训练", "跑步", "三分化", "五分化", "蛋白粉", "增肌"],
    searchQueries: ["减脂 力量训练 新手", "健身房新手 三分化"],
    controversial: false,
  },
  {
    name: "手冲咖啡",
    keywords: ["手冲", "咖啡", "v60", "滤杯", "磨豆机", "水温", "kalita"],
    searchQueries: ["手冲咖啡 入门 器具", "V60 滤杯 新手"],
    controversial: false,
  },
  {
    name: "AI Agent 产品设计",
    keywords: ["agent", "智能体", "工具调用", "tool calling", "交互范式", "确认", "任务完成率", "评测"],
    searchQueries: ["AI Agent 产品设计", "Agent 评测 指标"],
    controversial: false,
  },
  {
    name: "RAG 检索增强",
    keywords: ["rag", "检索", "chunk", "rerank", "召回", "知识库", "query rewrite", "graphrag", "向量"],
    searchQueries: ["RAG 效果优化 chunk", "RAG rerank 召回率"],
    controversial: false,
  },
  {
    name: "AI 是否取代程序员",
    keywords: ["取代程序员", "取代", "初级程序员", "岗位消失", "ai 编程", "被 ai", "焦虑"],
    searchQueries: ["AI 会取代程序员吗"],
    controversial: true,
    question: "AI 会在几年内取代大部分初级程序员吗？",
    pro: { label: "会被取代", query: "AI 取代初级程序员 案例", cues: ["会消失", "会被取代", "取代大半", "站不住脚", "支持我观点"] },
    con: { label: "不会被取代", query: "AI 不会取代程序员 理由", cues: ["只是工具", "需求会增加", "不会取代"] },
  },
  {
    name: "大厂 vs 创业公司",
    keywords: ["大厂", "创业公司", "期权", "offer", "内耗", "窗口期", "估值", "产品负责人"],
    searchQueries: ["大厂还是创业公司"],
    controversial: true,
    question: "职业中期应该选大厂还是创业公司？",
    pro: { label: "去创业公司", query: "创业公司 成长快 值得", cues: ["想去创业公司", "内耗", "ppt", "真正做产品", "窗口期"] },
    con: { label: "留在大厂", query: "大厂 稳定 值得去", cues: ["大厂稳定", "倒闭率", "现金"] },
  },
  {
    name: "公路车骑行",
    keywords: ["公路车", "碳架", "铝架", "套件", "105", "tiagra", "锁鞋", "骑行"],
    searchQueries: ["公路车入门 预算 8000", "105 套件 Tiagra 区别"],
    controversial: false,
  },
  {
    name: "远程办公效率",
    keywords: ["远程", "在家办公", "专注", "番茄钟", "深度工作", "异步", "共享办公", "时区", "效率"],
    searchQueries: ["远程办公 效率 专注", "深度工作 时间管理"],
    controversial: false,
  },
  {
    name: "自由职业收入",
    keywords: ["自由职业", "接项目", "收入不稳定", "尾款", "社保", "个体户", "客户"],
    searchQueries: ["自由职业 收入不稳定", "自由职业者 社保 个体户"],
    controversial: false,
  },
  {
    name: "回老家 vs 留在大城市",
    keywords: ["回老家", "老家", "三线城市", "小城市", "大城市", "杭州", "定居", "房价", "买房"],
    searchQueries: ["回老家还是留在大城市"],
    controversial: true,
    question: "远程工作者应该回老家定居还是留在大城市？",
    pro: { label: "回老家", query: "回老家 生活 幸福 远程工作", cues: ["回老家", "该回", "决定明年回", "父母也在身边", "不甘心", "幸存者偏差"] },
    con: { label: "留在大城市", query: "留在大城市 机会 值得", cues: ["机会多", "圈子", "回不去"] },
  },
  {
    name: "独立开发变现",
    keywords: ["独立开发", "插件", "订阅", "买断", "变现", "product hunt", "出海", "推广", "付费"],
    searchQueries: ["独立开发者 变现 订阅 买断", "独立开发 出海 英文市场"],
    controversial: false,
  },
  {
    name: "极简主义",
    keywords: ["极简", "断舍离", "数字极简", "消费主义", "app"],
    searchQueries: ["极简主义 断舍离 方法"],
    controversial: false,
  },
  {
    name: "跑步训练",
    keywords: ["半马", "训练计划", "膝盖", "髂胫束", "心率", "跑鞋", "5 公里", "跑步"],
    searchQueries: ["半马 12 周 训练计划", "跑步 膝盖外侧疼 髂胫束"],
    controversial: false,
  },
];

export function findLexiconEntry(topicName: string): LexiconEntry | undefined {
  const lower = topicName.toLowerCase();
  return LEXICON.find(
    (entry) =>
      entry.name.toLowerCase() === lower ||
      lower.includes(entry.name.toLowerCase()) ||
      entry.keywords.some((keyword) => keyword.length >= 2 && lower.includes(keyword.toLowerCase())),
  );
}
