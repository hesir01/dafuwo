import Phaser from 'phaser'
import BootScene from './scenes/BootScene.js'
import LobbyScene from './scenes/LobbyScene.js'
import SelectScene from './scenes/SelectScene.js'
import BoardScene from './scenes/BoardScene.js'
import { createSocket } from './net/socketClient.js'
import { openSettingsPanel } from './ui/settings.js'
import { installVersionGuard } from './ui/versionGuard.js'

const socket = createSocket()

const config = {
  // ?canvas=1 强制 Canvas 渲染器（调试高 DPI 显示问题用；正常走 AUTO 自动选 WebGL）
  type: new URLSearchParams(location.search).has('canvas') ? Phaser.CANVAS : Phaser.AUTO,
  parent: 'game',
  backgroundColor: '#0b1e3a',
  pixelArt: false,
  roundPixels: false,
  scale: {
    mode: Phaser.Scale.RESIZE,
    autoCenter: Phaser.Scale.CENTER_BOTH,
    width: window.innerWidth,
    height: window.innerHeight
  },
  scene: [BootScene, LobbyScene, SelectScene, BoardScene]
}

const game = new Phaser.Game(config)
game.registry.set('socket', socket)

// ---------- 高分屏文字清晰度修复 ----------
// 根因：Text 默认以 resolution=1 把文字画进内部画布，在 Retina 屏（dpr=2）上
// 被浏览器拉伸一倍显示 → 全部文字发糊。Phaser 3.90 没有全局 resolution 配置项，
// 这里在原型层统一注入：所有 Text 的纹理按 devicePixelRatio 渲染，
// 坐标系与布局保持 CSS 像素不变，只提升文字纹理清晰度。
const DPR = Math.min(window.devicePixelRatio || 1, 2)
const origUpdateText = Phaser.GameObjects.Text.prototype.updateText
Phaser.GameObjects.Text.prototype.updateText = function () {
  const cur = this.style.resolution
  if (!cur || cur < DPR) this.style.resolution = DPR
  const ret = origUpdateText.call(this)
  // 关键：同步纹理源分辨率。构造时 source.resolution=1 已固化，Canvas 渲染器
  // 按 source.resolution 折算显示尺寸（drawImage 宽高 / res）——不同步会导致
  // Canvas 模式（WebGL 不可用时）下所有文字显示为 2 倍大、溢出容器被裁断。
  if (this.frame && this.frame.source) this.frame.source.resolution = this.style.resolution
  return ret
}
// 全局设置入口：任意场景都能打开（主菜单 / 大厅均有可见入口）
game.registry.set('openSettings', (scene, opts) => openSettingsPanel(scene, opts))

// ---------- 高分屏（HiDPI）真实分辨率渲染 ----------
// 问题：Phaser 的 RESIZE 模式把 canvas 背衬缓冲设成 CSS 像素（960×533），
// Retina（dpr=2）上浏览器会把整块画布拉伸到 1920×1066 显示 → 整个画面发糊；
// 而 dpr=1 的电脑是 1:1，于是「同一局游戏，不同电脑清晰度差一截」。
// 做法：背衬缓冲放大到设备像素，但相机 / 布局 / 投影矩阵仍然以 CSS 像素思考，
// 只在真正提交给 WebGL 时把 viewport / scissor 的坐标乘上 DPR。
// 这样零布局改动就能拿到真·2x 渲染（Graph 矢量、文字纹理都按设备像素画）。
function installHiDPI (game) {
  const gl = game.renderer && game.renderer.gl
  window.__renderScale = 1
  if (!gl || DPR === 1) return
  window.__renderScale = DPR
  // Phaser 内部用 drawingBufferWidth/Height 做 y 轴翻转与裁剪计算；
  // 让它继续读「CSS 像素」，缩放统一由下面的 viewport/scissor 包装器负责。
  Object.defineProperty(gl, 'drawingBufferWidth', { get: () => Math.round(game.scale.width), configurable: true })
  Object.defineProperty(gl, 'drawingBufferHeight', { get: () => Math.round(game.scale.height), configurable: true })
  const rawViewport = gl.viewport.bind(gl)
  const rawScissor = gl.scissor.bind(gl)
  gl.viewport = (x, y, w, h) => rawViewport(x * DPR, y * DPR, w * DPR, h * DPR)
  gl.scissor = (x, y, w, h) => rawScissor(x * DPR, y * DPR, w * DPR, h * DPR)

  const sync = () => {
    const c = game.canvas
    if (!c) return
    const w = Math.round(game.scale.width * DPR)
    const h = Math.round(game.scale.height * DPR)
    if (c.width !== w || c.height !== h) {
      c.width = w
      c.height = h
    }
    // CSS 尺寸保持逻辑像素，浏览器不再做二次放大
    c.style.width = `${game.scale.width}px`
    c.style.height = `${game.scale.height}px`
    // Phaser 只在管线切换时才重设 viewport（静态画面里可能一帧都不调），
    // 这里主动把绘制区域铺满整个设备像素缓冲：投影矩阵按 CSS 像素算，
    // 视口按设备像素铺，二者在 NDC 上天然对齐。
    rawViewport(0, 0, w, h)
    rawScissor(0, 0, w, h)
  }
  // ScaleManager 每次 resize 都会把 canvas.width 重置成 CSS 尺寸，这里再接管回来
  game.scale.on('resize', sync)
  // 换场景 / 建渲染目标后 Phaser 可能重设 viewport，每帧开局兜一次底（幂等、开销可忽略）
  game.events.on(Phaser.Core.Events.PRE_RENDER, sync)
  sync()
}
game.events.once('ready', () => installHiDPI(game))

// 版本守卫：确保所有人玩的是同一版前端（浏览器缓存旧页面时给刷新提示）
installVersionGuard()

window.__game = game
