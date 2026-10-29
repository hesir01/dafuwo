// 棋盘事件特效开关
//
// FX_SPRITE_ENABLED：是否播放 AI 生成的 8 帧位图特效（assets/fx/sheets/）。
// 2026-10-28 关闭：那批素材画面质量不达标（构图杂、帧间不连贯），
// 关掉后事件反馈只保留「音效 + 飘字 + 格子光圈（Phaser 绘制）」。
// 以后若重新生成到合格素材，把它改回 true 即可，无需改调用点。
export const FX_SPRITE_ENABLED = false
