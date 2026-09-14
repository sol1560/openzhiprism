import { describe, expect, it } from "vitest";
import { redactText } from "@/lib/ingest/privacy";

describe("redactText", () => {
  it("隐去手机号、邮箱、身份证片段、收入金额与姓名提示", () => {
    const input = "我的电话是 13812345678，邮箱 lin2004@example.com，身份证号后四位是 5678，年薪 65 万，对接人姓王";
    const result = redactText(input);
    expect(result.text).not.toContain("13812345678");
    expect(result.text).not.toContain("lin2004@example.com");
    expect(result.text).not.toContain("5678");
    expect(result.text).not.toContain("65 万");
    expect(result.text).toContain("年薪[金额已隐去]");
    expect(result.total).toBe(5);
    expect(result.redactions.map((item) => item.category).sort()).toEqual(
      ["email", "id_card", "income", "name_hint", "phone"].sort(),
    );
  });

  it("保留话题层面的数字（预算、公里数不算财务隐私）", () => {
    const result = redactText("想入门公路车，预算 8000 左右；5 公里能跑进 27 分钟");
    expect(result.total).toBe(0);
    expect(result.text).toContain("预算 8000");
  });

  it("不误伤普通长数字以外的内容", () => {
    const result = redactText("V60 和 kalita 蛋糕杯区别大吗？水温 92 度");
    expect(result.total).toBe(0);
  });
});
