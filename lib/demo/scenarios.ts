import samples from "./samples.json";
import { stripHtml } from "@/lib/zhihu/text";
import type { DemoArticle } from "./types";
import type { DemoScenario } from "./types";
import { DEMO_SUMMARIES } from "./summary-overrides";

// Curated from fixtures/personas; quotes are shortened for the landing preview.
// Article metadata and excerpts retain their original fixture provenance.
const RAW_SCENARIOS: DemoScenario[] = [
  {
    id: "lin-student", name: "林同学", role: "在探索未来的大学生",
    description: "一边准备下一步，一边给好奇心留点位置。",
    interests: [
      { id: "study", name: "考研与就业", weight: 90, message: "我是大三的学生，很纠结要不要考研。不考研，会不会找不到好工作？", reply: "先从你想进入的行业、想做的工作聊起。", articles: samples["考研还是直接工作"] },
      { id: "python", name: "Python 数据分析", weight: 65, message: "我想系统学 Python 数据分析，pandas 和 numpy 应该先学哪个？", reply: "从数组到表格，再用一个真实问题把它们串起来。", articles: samples["python-数据分析"] },
      { id: "intern", name: "实习求职", weight: 45, message: "想找数据分析实习，但简历上只有课程项目，会不会太单薄？", reply: "先把你解决过的问题和做出的结果讲清楚。", articles: samples["实习求职"] },
    ],
    light: samples["手冲咖啡-入门-器具"][0],
    perspective: { topicId: "study", question: "考研，还是先去工作？", context: "这段示例对话更担心学历不够。也听听已经工作过、又回到校园的人怎么说。", sides: [
      { label: "另一种看法", description: "先弄清想做什么，再判断读研能否帮助自己。工作经历也可能让目标变得清晰。", article: samples["考研还是直接工作"][0] },
      { label: "继续深造", description: "有些行业对学历有明确要求。结合家庭支持和学习意愿，读研也可能是值得投入的一步。", article: samples["考研还是直接工作"][1] },
      { label: "一起权衡", description: "列出目标岗位的门槛、两条路线的时间成本和眼下可获得的机会。先做一次实习或访谈，再给自己一个决定的时间点。" },
    ] },
  },
  {
    id: "zhou-pm", name: "周产品", role: "正在转向 AI 的产品经理",
    description: "关心产品怎么落地，也关心人的位置会怎样变化。",
    interests: [
      { id: "agent", name: "AI Agent 产品", weight: 90, message: "销售 Agent 想做的功能太多了：写邮件、更新 CRM、预测成单。怎么划边界？", reply: "从一个低风险、可撤销的工作流程开始。", articles: samples["ai-agent-产品设计"] },
      { id: "rag", name: "RAG 与检索", weight: 65, message: "知识库问答经常检索到不相关的段落，chunk 大小是不是不合适？", reply: "把检索和生成分开评估，找到问题发生在哪一步。", articles: samples["rag-rerank-召回率"] },
      { id: "coding", name: "AI 与程序员", weight: 45, message: "用了 AI 编程工具后，团队效率高了很多。初级程序员的岗位会消失吗？", reply: "写代码的速度在变化，需求和责任也值得一起看。", articles: samples["ai-是否取代程序员"] },
    ],
    light: samples["公路车骑行"][1],
    perspective: { topicId: "coding", question: "AI 会取代程序员吗？", context: "效率提高，并不直接等于岗位消失。这里补充工程实践中的另一面。", sides: [
      { label: "另一种看法", description: "识别隐藏需求、判断边界、为交付负责，仍然是工程工作的一部分。", article: samples["ai-不会取代程序员-理由"][0] },
      { label: "变化正在发生", description: "一些重复性的编码任务正在变化，岗位所需要的技能也会随之调整。", article: samples["ai-是否取代程序员"][1] },
      { label: "一起权衡", description: "把工作拆成具体任务：哪些适合交给 AI，哪些需要人的判断？观察真实交付结果，比只比较代码生成速度更有帮助。" },
    ] },
  },
  {
    id: "chen-freelancer", name: "陈自由", role: "远程工作的独立开发者",
    description: "想让工作更自由，也让生活更有自己的节奏。",
    interests: [
      { id: "city", name: "城市与生活", weight: 90, message: "我远程工作，是不是可以回老家生活？又有点舍不得现在的朋友和机会。", reply: "生活成本之外，也看看社交、职业网络和日常需要。", articles: samples["回老家-vs-留在大城市"] },
      { id: "remote", name: "远程办公", weight: 65, message: "在家办公总是分心，一天真正专注的时间不到三小时。有什么办法？", reply: "试着给环境和时间划出边界，让开始工作更容易。", articles: samples["远程办公效率"] },
      { id: "indie", name: "独立开发", weight: 45, message: "我的浏览器插件有了一些用户，想开始收费。选订阅还是买断？", reply: "结合持续维护成本和用户获得价值的频率来判断。", articles: samples["独立开发变现"] },
    ],
    light: samples["跑步训练"][1],
    perspective: { topicId: "city", question: "远程工作，还需要留在大城市吗？", context: "住在哪里，不只是一道成本题。把职业机会和生活需要一起放上桌。", sides: [
      { label: "另一种看法", description: "即使工作可以远程，职业网络、朋友和新机会仍然可能与城市有关。", article: samples["留在大城市-机会-值得"][0] },
      { label: "重新看生活", description: "城市带来的选择值得珍惜，生活的节奏和自己的感受也同样值得认真对待。", article: samples["回老家-vs-留在大城市"][0] },
      { label: "一起权衡", description: "先短住一段时间，体验工作节奏、医疗交通和社交生活。把决定做成一次可以回头的尝试，再考虑长期定居。" },
    ] },
  },
];

function cleanArticle(article: DemoArticle): DemoArticle {
  return { ...article, title: stripHtml(article.title), authorName: stripHtml(article.authorName), summary: DEMO_SUMMARIES[article.id] ?? stripHtml(article.summary), excerpt: stripHtml(article.excerpt) };
}
export const DEMO_SCENARIOS = RAW_SCENARIOS.map((scenario) => ({ ...scenario,
  interests: scenario.interests.map((interest) => ({ ...interest, articles: interest.articles.map(cleanArticle) })),
  light: cleanArticle(scenario.light),
  perspective: { ...scenario.perspective, sides: scenario.perspective.sides.map((side) => ({ ...side, article: side.article ? cleanArticle(side.article) : undefined })) },
}));
