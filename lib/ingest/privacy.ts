/**
 * 隐私预过滤：在文本送入 LLM 之前，用正则把明显的个人信息替换为占位符。
 * 只保留话题层面的信息；LLM 侧还有第二道指令级过滤。
 */

export type RedactionCategory =
  | "phone"
  | "id_card"
  | "email"
  | "bank_card"
  | "address"
  | "income"
  | "name_hint";

export interface Redaction {
  category: RedactionCategory;
  count: number;
}

export interface RedactResult {
  text: string;
  redactions: Redaction[];
  total: number;
}

const LABELS: Record<RedactionCategory, string> = {
  phone: "手机号",
  id_card: "身份证",
  email: "邮箱",
  bank_card: "银行卡",
  address: "地址",
  income: "收入金额",
  name_hint: "姓名",
};

export function redactionLabel(category: RedactionCategory): string {
  return LABELS[category];
}

interface Rule {
  category: RedactionCategory;
  pattern: RegExp;
  replacement: string;
}

const RULES: Rule[] = [
  { category: "email", pattern: /[\w.+-]+@[\w-]+(\.[\w-]+)+/g, replacement: "[邮箱已隐去]" },
  { category: "id_card", pattern: /\b\d{17}[\dXx]\b/g, replacement: "[身份证号已隐去]" },
  {
    category: "id_card",
    pattern: /身份证(号)?(码)?(后|前)?[四六]位(是|为)?\s*[:：]?\s*\d{4,6}/g,
    replacement: "身份证信息[已隐去]",
  },
  { category: "bank_card", pattern: /\b\d{16,19}\b/g, replacement: "[银行卡号已隐去]" },
  { category: "phone", pattern: /(?<!\d)1[3-9]\d{9}(?!\d)/g, replacement: "[手机号已隐去]" },
  {
    category: "address",
    pattern: /[\u4e00-\u9fa5]{2,8}(路|街|大道|巷)\s*\d{1,4}\s*号([\u4e00-\u9fa5\d]{0,10}(室|栋|单元|楼))?/g,
    replacement: "[地址已隐去]",
  },
  {
    category: "income",
    pattern: /(年薪|月薪|工资|税前|税后|存款|收入|房贷|贷款|生活费)[^\d，,。\n]{0,6}\d+(\.\d+)?\s*(万|k|K|w|W|元|块)?/g,
    replacement: "$1[金额已隐去]",
  },
  {
    category: "name_hint",
    pattern: /(对接人|联系人|我叫|我的名字是|老板叫|同事叫)\s*[姓]?\s*[\u4e00-\u9fa5]{1,3}/g,
    replacement: "$1[姓名已隐去]",
  },
];

export function redactText(input: string): RedactResult {
  let text = input;
  const counts = new Map<RedactionCategory, number>();
  for (const rule of RULES) {
    text = text.replace(rule.pattern, (...args) => {
      counts.set(rule.category, (counts.get(rule.category) ?? 0) + 1);
      const groups = args.slice(0, -2) as string[];
      return rule.replacement.replace(/\$(\d)/g, (_, index: string) => groups[Number(index)] ?? "");
    });
  }
  const redactions = [...counts.entries()].map(([category, count]) => ({ category, count }));
  return { text, redactions, total: redactions.reduce((sum, item) => sum + item.count, 0) };
}
