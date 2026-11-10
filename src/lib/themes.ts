// Shared by the first-paint script and the interactive theme control.
export const themeOrder = [
  "paper", "moon", "sand", "ink", "celadon", "bamboo", "lotus", "dusk",
] as const;

export type InkRainTheme = typeof themeOrder[number];

export const themes: Record<InkRainTheme, { name: string; color: string; dark: boolean }> = {
  paper: { name: "宣纸", color: "#f4f0e6", dark: false },
  moon: { name: "月白", color: "#edf4f3", dark: false },
  sand: { name: "鸣沙", color: "#f2e3c5", dark: false },
  ink: { name: "玄墨", color: "#20272b", dark: true },
  celadon: { name: "青瓷", color: "#e0eee8", dark: false },
  bamboo: { name: "竹影", color: "#f3f9f1", dark: false },
  lotus: { name: "藕荷", color: "#f8f4f3", dark: false },
  dusk: { name: "暮山", color: "#3d3b4f", dark: true },
};
