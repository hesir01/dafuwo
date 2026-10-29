// ============================================================
// 单一数据源：所有数值 / 文案 / 配置集中于此。
// 调平衡只改本文件；engine.js 不写死任何数值。
// ============================================================

// 经济数值
export const ECONOMY = {
  START_CASH: 2000,
  GO_SALARY: 200,
  GO_SALARY_COOK: 300,
  TAX_FLAT: 100,
  TAX_PER_ISLAND: 25,
  BAIL: 100,
  PORT_SUPPLY: 80,
  HISTORY_BUY: 200,
  HISTORY_BUY_ROBIN: 100,
  HAND_LIMIT: 5,
  SELL_RATE: 0.5,
  // 布鲁克·黄泉复活的单笔免债上限（超出部分照常变卖/破产）
  // 依据：tools/balance_sim.mjs 3000 局模拟胜率 1.35x 基线，加容错上限收敛（见 10 报告 2026-10-29）
  REVIVE_WAIVE_MAX: 400
}

// 骰子
export const DICE = {
  COUNT: 2,
  SIDES: 6,
  MIN_POINT: 2,
  MAX_POINT: 12,
  MAX_DOUBLES_BEFORE_JAIL: 3
}

// 格子类型
export const CELL_TYPES = {
  GO: 'go',
  ISLAND: 'island',
  RANDOM_ISLAND: 'random_island',
  JAIL: 'jail',
  PORT: 'port',
  TAX: 'tax',
  FRUIT: 'fruit',
  EVENT: 'event',
  HISTORY: 'history',
  LAUGH_TALE: 'laugh_tale'
}

// 海域
export const SEAS = {
  east: { id: 'east', name: '东海', color: '#5aa9e6' },
  grand: { id: 'grand', name: '伟大航路', color: '#b07cd6' },
  new: { id: 'new', name: '新世界', color: '#e0654f' }
}

// ============================================================
// 22 个岛屿：rent = [基础, 1级, 2级, 3级]
// ============================================================
export const ISLANDS = [
  // ---- 东海 ----
  { id: 1, name: '谢尔兹镇', sea: 'east', group: 'g1', price: 60,  rent: [10, 30, 80, 200],   upgradeCost: 40,  icon: '/islands/isl_east_01_shells_128.png' },
  { id: 2, name: '橘子镇', sea: 'east', group: 'g1', price: 80,  rent: [10, 30, 80, 200],   upgradeCost: 50,  icon: '/islands/isl_east_02_orange_128.png' },
  { id: 3, name: '西罗布村', sea: 'east', group: 'g1', price: 100, rent: [15, 45, 120, 300],  upgradeCost: 60,  icon: '/islands/isl_east_03_syrup_128.png' },
  { id: 4, name: '可可西亚村', sea: 'east', group: 'g2', price: 110, rent: [15, 45, 120, 300],  upgradeCost: 70,  icon: '/islands/isl_east_04_cocoyasi_128.png' },
  { id: 5, name: '巴拉蒂海上餐厅', sea: 'east', group: 'g2', price: 120, rent: [20, 60, 160, 400],  upgradeCost: 70,  icon: '/islands/isl_east_05_baratie_128.png' },
  { id: 6, name: '罗格镇', sea: 'east', group: 'g2', price: 140, rent: [20, 60, 160, 400],  upgradeCost: 80,  icon: '/islands/isl_east_06_loguetown_128.png' },
  // ---- 伟大航路 ----
  { id: 7, name: '威士忌山峰', sea: 'grand', group: 'g3', price: 180, rent: [25, 75, 200, 500],  upgradeCost: 110, icon: '/islands/isl_grand_01_whisky_128.png' },
  { id: 8, name: '小花园', sea: 'grand', group: 'g3', price: 200, rent: [30, 90, 240, 600],  upgradeCost: 120, icon: '/islands/isl_grand_02_littlegarden_128.png' },
  { id: 9, name: '磁鼓岛', sea: 'grand', group: 'g3', price: 220, rent: [30, 90, 240, 600],  upgradeCost: 130, icon: '/islands/isl_grand_03_drum_128.png' },
  { id: 10, name: '阿拉巴斯坦', sea: 'grand', group: 'g4', price: 240, rent: [35, 105, 280, 700], upgradeCost: 140, icon: '/islands/isl_grand_04_alabasta_128.png' },
  { id: 11, name: '空岛', sea: 'grand', group: 'g4', price: 260, rent: [40, 120, 320, 800], upgradeCost: 160, icon: '/islands/isl_grand_05_skypiea_128.png' },
  { id: 12, name: '水之都', sea: 'grand', group: 'g4', price: 270, rent: [40, 120, 320, 800], upgradeCost: 160, icon: '/islands/isl_grand_06_water7_128.png' },
  { id: 13, name: '司法岛', sea: 'grand', group: 'g5', price: 280, rent: [40, 120, 320, 800], upgradeCost: 170, icon: '/islands/isl_grand_07_ennis_128.png' },
  { id: 14, name: '恐怖三桅帆船', sea: 'grand', group: 'g5', price: 290, rent: [45, 135, 360, 900], upgradeCost: 170, icon: '/islands/isl_grand_08_thriller_128.png' },
  { id: 15, name: '香波地群岛', sea: 'grand', group: 'g5', price: 300, rent: [45, 135, 360, 900], upgradeCost: 180, icon: '/islands/isl_grand_09_sabaody_128.png' },
  // ---- 新世界 ----
  { id: 16, name: '鱼人岛', sea: 'new', group: 'g6', price: 340, rent: [50, 150, 400, 1000], upgradeCost: 200, icon: '/islands/isl_new_01_fishman_128.png' },
  { id: 17, name: '庞克哈萨德', sea: 'new', group: 'g6', price: 370, rent: [55, 165, 440, 1100], upgradeCost: 220, icon: '/islands/isl_new_02_punk_128.png' },
  { id: 18, name: '德雷斯罗萨', sea: 'new', group: 'g6', price: 400, rent: [60, 180, 480, 1200], upgradeCost: 240, icon: '/islands/isl_new_03_dressrosa_128.png' },
  { id: 19, name: '佐乌', sea: 'new', group: 'g7', price: 420, rent: [65, 195, 520, 1300], upgradeCost: 250, icon: '/islands/isl_new_04_zou_128.png' },
  { id: 20, name: '蛋糕岛', sea: 'new', group: 'g7', price: 450, rent: [65, 195, 520, 1300], upgradeCost: 270, icon: '/islands/isl_new_05_wholecake_128.png' },
  { id: 21, name: '和之国', sea: 'new', group: 'g7', price: 470, rent: [70, 210, 560, 1400], upgradeCost: 280, icon: '/islands/isl_new_06_wano_128.png' },
  { id: 22, name: '艾格赫德', sea: 'new', group: 'g7', price: 500, rent: [75, 225, 600, 1500], upgradeCost: 300, icon: '/islands/isl_new_07_egghead_128.png' }
]

// 按 id 快速取岛屿
export const ISLAND_BY_ID = Object.fromEntries(ISLANDS.map((i) => [i.id, i]))

// 棋盘格名牌简称：格子只有 40~50px 宽，5 字以上原名换行会被挤出格子。
// 只有棋盘（和悬停提示以外的地方）用简称，档案 / 日志 / 岛屿详情仍用全名。
export const ISLAND_SHORT = {
  4: '可可西亚',
  5: '巴拉蒂',
  7: '威士忌',
  10: '阿拉巴',
  14: '恐怖帆船',
  15: '香波地',
  17: '庞克哈萨',
  18: '德雷斯'
}

// ============================================================
// 7 个垄断分组
// ============================================================
export const MONOPOLY_GROUPS = [
  { id: 'g1', name: '东海·A', sea: 'east', islandIds: [1, 2, 3] },
  { id: 'g2', name: '东海·B', sea: 'east', islandIds: [4, 5, 6] },
  { id: 'g3', name: '伟大航路·A', sea: 'grand', islandIds: [7, 8, 9] },
  { id: 'g4', name: '伟大航路·B', sea: 'grand', islandIds: [10, 11, 12] },
  { id: 'g5', name: '伟大航路·C', sea: 'grand', islandIds: [13, 14, 15] },
  { id: 'g6', name: '新世界·A', sea: 'new', islandIds: [16, 17, 18] },
  { id: 'g7', name: '新世界·B', sea: 'new', islandIds: [19, 20, 21, 22] }
]

// ============================================================
// 40 格环形棋盘（顺时针；角：0 起点 / 10 监狱 / 20 拉夫德鲁 / 30 历史正文）
// 每格：{ type, islandId? }
// ============================================================
export const BOARD_SIZE = 40

export const BOARD = [
  { type: 'go' },                       // 0  起点·颠倒山
  { type: 'island', islandId: 1 },      // 1
  { type: 'island', islandId: 2 },      // 2
  { type: 'island', islandId: 3 },      // 3
  { type: 'event' },                    // 4
  { type: 'island', islandId: 4 },      // 5
  { type: 'island', islandId: 5 },      // 6
  { type: 'fruit' },                    // 7
  { type: 'island', islandId: 6 },      // 8
  { type: 'tax' },                      // 9
  { type: 'jail' },                     // 10 推进城
  { type: 'island', islandId: 7 },      // 11
  { type: 'island', islandId: 8 },      // 12
  { type: 'island', islandId: 9 },      // 13
  { type: 'event' },                    // 14
  { type: 'island', islandId: 10 },     // 15
  { type: 'island', islandId: 11 },     // 16
  { type: 'port' },                     // 17
  { type: 'island', islandId: 12 },     // 18
  { type: 'island', islandId: 13 },     // 19
  { type: 'laugh_tale' },               // 20 拉夫德鲁
  { type: 'island', islandId: 14 },     // 21
  { type: 'island', islandId: 15 },     // 22
  { type: 'event' },                    // 23
  { type: 'island', islandId: 16 },     // 24
  { type: 'fruit' },                    // 25
  { type: 'island', islandId: 17 },     // 26
  { type: 'island', islandId: 18 },     // 27
  { type: 'port' },                     // 28
  { type: 'island', islandId: 19 },     // 29
  { type: 'history' },                  // 30
  { type: 'island', islandId: 20 },     // 31
  { type: 'island', islandId: 21 },     // 32
  { type: 'event' },                    // 33
  { type: 'island', islandId: 22 },     // 34
  { type: 'fruit' },                    // 35
  { type: 'tax' },                      // 36
  { type: 'random_island' },            // 37
  { type: 'history' },                  // 38
  { type: 'random_island' }             // 39
]

// 特殊格图标（供渲染）
export const CELL_ICONS = {
  go: '/cells/cell_reverse_mountain_128.png',
  event: '/cells/cell_event_128.png',
  fruit: '/cells/cell_devil_fruit_128.png',
  tax: '/cells/cell_heavenly_tribute_128.png',
  jail: '/cells/cell_impel_down_128.png',
  port: '/cells/cell_port_128.png',
  history: '/cells/cell_poneglyph_128.png',
  laugh_tale: '/cells/cell_laugh_tale_128.png'
}

// 10 个棋子（token）
export const TOKEN_ICONS = [
  '/tokens/char_01_captain_token_64.png',
  '/tokens/char_02_swordsman_token_64.png',
  '/tokens/char_03_navigator_token_64.png',
  '/tokens/char_04_cook_token_64.png',
  '/tokens/char_05_sniper_token_64.png',
  '/tokens/char_06_doctor_token_64.png',
  '/tokens/char_07_archaeologist_token_64.png',
  '/tokens/char_08_shipwright_token_64.png',
  '/tokens/char_09_musician_token_64.png',
  '/tokens/char_10_helmsman_token_64.png'
]

// ============================================================
// 10 名角色（草帽团）：skillType = active 主动 / passive 被动
// skillUses：主动技能每局限次；skill 字段由 engine 解释
// ============================================================
export const CHARACTERS = [
  { id: 1, key: 'captain', name: '路飞', title: '船长',
    skillName: '橡胶耍赖', skillType: 'active', skillUses: 1,
    skillIcon: '/skills/skill_01.png', desc: '免除一次本回合需缴纳的租金（过路费）' },
  { id: 2, key: 'swordsman', name: '索隆', title: '剑士',
    skillName: '迷路斩', skillType: 'passive', skillUses: 0,
    skillIcon: '/skills/skill_02.png', desc: '掷出双1（蛇眼）时朝反方向移动；购买任何岛屿打8折' },
  { id: 3, key: 'navigator', name: '娜美', title: '航海士',
    skillName: '贪财天候', skillType: 'passive', skillUses: 0,
    skillIcon: '/skills/skill_03.png', desc: '别人停在你的岛屿时，租金多收20%' },
  { id: 4, key: 'cook', name: '山治', title: '厨师',
    skillName: '厨房补给', skillType: 'passive', skillUses: 0,
    skillIcon: '/skills/skill_04.png', desc: '经过起点时经费多领20%（领240）' },
  { id: 5, key: 'sniper', name: '乌索普', title: '狙击手',
    skillName: '狙击预判', skillType: 'active', skillUses: 2,
    skillIcon: '/skills/skill_05.png', desc: '掷骰后可重掷（双骰整体重掷），二选一，每局限 2 次' },
  { id: 6, key: 'doctor', name: '乔巴', title: '船医',
    skillName: '应急治疗', skillType: 'active', skillUses: 1,
    skillIcon: '/skills/skill_06.png', desc: '本次受到的负面事件/罚款损失减半' },
  { id: 7, key: 'archaeologist', name: '罗宾', title: '考古学家',
    skillName: '历史解读', skillType: 'passive', skillUses: 0,
    skillIcon: '/skills/skill_07.png', desc: '历史正文格购买半价；历史正文线索权重×2；抽事件正面卡概率+15%' },
  { id: 8, key: 'shipwright', name: '弗兰奇', title: '船匠',
    skillName: '改造建造', skillType: 'passive', skillUses: 0,
    skillIcon: '/skills/skill_08.png', desc: '升级岛屿费用打7折' },
  { id: 9, key: 'musician', name: '布鲁克', title: '音乐家',
    skillName: '黄泉复活', skillType: 'active', skillUses: 1,
    skillIcon: '/skills/skill_09.png', desc: '即将因租金/保释金债务破产时，免除该笔债务（免债上限 400）' },
  { id: 10, key: 'helmsman', name: '甚平', title: '舵手',
    skillName: '精通海流', skillType: 'passive', skillUses: 0,
    skillIcon: '/skills/skill_10.png', desc: '免疫海王类、暴风雨等海上负面事件，遇袭反得30贝利' }
]

export const CHARACTER_BY_ID = Object.fromEntries(CHARACTERS.map((c) => [c.id, c]))

// ============================================================
// 10 种恶魔果实（主动道具）
// target: none / player / self / random_player；aoe: 是否群体
// ============================================================
export const FRUITS = [
  { id: 'dark', name: '暗暗果实', target: 'player', aoe: false,
    icon: '/fruits/fruit_01_dark_96.png', desc: '偷取指定玩家手中1张随机道具卡（不可偷历史正文）' },
  { id: 'quake', name: '震震果实', target: 'none', aoe: true,
    icon: '/fruits/fruit_02_quake_96.png', desc: '引发海震，其他所有玩家各损失80贝利（各自可抵消）' },
  { id: 'light', name: '闪闪果实', target: 'self', aoe: false,
    icon: '/fruits/fruit_03_light_96.png', desc: '本回合再前进1–6格（再掷一次）' },
  { id: 'ice', name: '冰冻果实', target: 'player', aoe: false,
    icon: '/fruits/fruit_04_ice_96.png', desc: '指定1名玩家下回合无法行动（被冻住）' },
  { id: 'magma', name: '岩浆果实', target: 'player', aoe: false,
    icon: '/fruits/fruit_05_magma_96.png', desc: '指定1名玩家强制后退3格' },
  { id: 'paw', name: '肉球果实', target: 'player', aoe: false,
    icon: '/fruits/fruit_06_paw_96.png', desc: '把指定玩家弹到随机一个格子' },
  { id: 'mochi', name: '糯糯果实', target: 'self', aoe: false,
    icon: '/fruits/fruit_07_mochi_96.png', desc: '抵消一次即将作用于自己的恶魔果实效果' },
  { id: 'op', name: '手术果实', target: 'player', aoe: false,
    icon: '/fruits/fruit_08_op_96.png', desc: '与任意一名玩家交换当前位置' },
  { id: 'flower', name: '花花果实', target: 'self', aoe: false,
    icon: '/fruits/fruit_09_flower_96.png', desc: '再抽1张事件卡并选择是否生效' },
  { id: 'chop', name: '四分五裂果实', target: 'self', aoe: false,
    icon: '/fruits/fruit_10_chop_96.png', desc: '本回合免疫所有租金（过路费）' }
]

export const FRUIT_BY_ID = Object.fromEntries(FRUITS.map((f) => [f.id, f]))

// ============================================================
// 3 种霸气卡
// ============================================================
export const HAKI = [
  { id: 'armament', name: '武装色霸气',
    icon: '/haki/haki_01_armament_96.png', desc: '抵消一次针对自己的恶魔果实效果' },
  { id: 'observation', name: '见闻色霸气',
    icon: '/haki/haki_02_observation_96.png', desc: '取消一次负面随机事件，或预览下一格' },
  { id: 'conqueror', name: '霸王色霸气',
    icon: '/haki/haki_03_conqueror_96.png', desc: '使用后其余所有玩家下回合掷点结果−2（最低1）' }
]

export const HAKI_BY_ID = Object.fromEntries(HAKI.map((h) => [h.id, h]))

// ============================================================
// 13 张航海事件卡
// kind: good 正面 / bad 负面 / neutral 中性；weight: 抽牌权重
// ============================================================
export const EVENTS = [
  { id: 'evt_01', name: '发现沉船宝藏', kind: 'good', weight: 10,
    icon: '/events/evt_01_treasure.png', desc: '+150贝利' },
  { id: 'evt_02', name: '革命军相助', kind: 'good', weight: 8,
    icon: '/events/evt_02_revolution.png', desc: '获得1张随机霸气卡' },
  { id: 'evt_03', name: '港口顺风', kind: 'good', weight: 7,
    icon: '/events/evt_03_tailwind.png', desc: '直接前进到下一个港口补给格' },
  { id: 'evt_04', name: '记录指针指引', kind: 'good', weight: 8,
    icon: '/events/evt_04_logpose_guide.png', desc: '前进2–5格' },
  { id: 'evt_05', name: '历史正文线索', kind: 'good', weight: 12,
    icon: '/events/evt_05_poneglyph.png', desc: '随机获得1块尚未被取得的路标历史正文；若已全部取得则+100贝利' },
  { id: 'evt_06', name: '遭遇海军围捕', kind: 'bad', weight: 10,
    icon: '/events/evt_06_navy.png', desc: '掷骰：偶数罚款80，奇数押进推进城' },
  { id: 'evt_07', name: '海王类袭击', kind: 'bad', weight: 9,
    icon: '/events/evt_07_seaking.png', desc: '损失70贝利（甚平免疫，反得30）' },
  { id: 'evt_08', name: '暴风雨失事', kind: 'bad', weight: 9,
    icon: '/events/evt_08_storm.png', desc: '后退2格并损失60贝利（甚平免疫，反得30）' },
  { id: 'evt_09', name: '被四皇盯上', kind: 'bad', weight: 9,
    icon: '/events/evt_09_yonko.png', desc: '按持有贝利的10%缴纳保护费（50–300）' },
  { id: 'evt_10', name: '食物中毒', kind: 'bad', weight: 8,
    icon: '/events/evt_10_foodpoison.png', desc: '损失80贝利（乔巴可减半）' },
  { id: 'evt_11', name: 'DAVY BACK争霸', kind: 'neutral', weight: 7,
    icon: '/events/evt_11_davyback.png', desc: '与随机玩家猜点数，赢家从对方拿100贝利' },
  { id: 'evt_12', name: '地下拍卖会', kind: 'neutral', weight: 7,
    icon: '/events/evt_12_auction.png', desc: '可按7折竞拍一个无主岛屿' },
  { id: 'evt_13', name: '记录指针紊乱', kind: 'neutral', weight: 8,
    icon: '/events/evt_13_logpose_chaos.png', desc: '传送到随机格子' }
]

export const EVENT_BY_ID = Object.fromEntries(EVENTS.map((e) => [e.id, e]))

// 手牌中卡片类型：fruit 果实 / haki 霸气 / history 历史正文
// 卡片实例：{ uid, kind:'fruit'|'haki'|'history', defId, historyId? }
export const ITEMS = []
