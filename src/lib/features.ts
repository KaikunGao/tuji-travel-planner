/**
 * 功能开关：方向转向「行程变更引擎」后先收起来的旧功能。
 * 只是不在界面上露出，代码和数据都还在；把对应的开关改成 true 就恢复。
 */
export const FEATURES = {
  /** AI 生成任意城市（生成的数据没法核验，和「只对算得准的东西下断言」冲突） */
  aiCity: false,
  /** 多方案对比（切换方案会丢掉手动调整，和「改得动」相反） */
  variants: false,
  /** 预算页（每一天和整份行程的花费合计仍然显示，改动代价要用） */
  budgetTab: false,
  /** 贴士页（含打包清单） */
  tipsTab: false,
  /** 分享弹窗里的二维码（分享链接本身保留） */
  shareQr: false,
  /** 首页列出全部内置城市；关掉时只列 FOCUS_CITY_IDS 里的城市 */
  allCities: false,
}

/** 先做透的三座城市。其他城市只是不在首页列出，已保存的行程和分享链接照常能打开 */
export const FOCUS_CITY_IDS = ['beijing', 'chengdu', 'xian']
