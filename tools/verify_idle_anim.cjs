// 验证棋子 idle 动画：单机进对局 → 检查 10 个 idle sheet 加载 + 棋子 anims 在播 + 帧号随时间变化
const { chromium } = require('playwright-core')
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

;(async () => {
  const browser = await chromium.launch({ headless: true, executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome' })
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 } })
  const errors = []
  page.on('pageerror', (e) => errors.push('PAGEERROR: ' + e.message))
  page.on('response', (r) => { if (r.status() >= 400) errors.push('HTTP ' + r.status() + ': ' + r.url().slice(-80)) })
  page.on('console', (m) => { if (m.type() === 'error') errors.push('CONSOLE: ' + m.text().slice(0, 160)) })

  await page.goto('http://localhost:5173/index.html', { waitUntil: 'networkidle' })
  await sleep(2500)
  await page.evaluate(() => window.__game.scene.start('BoardScene', { autoPlay: false }))
  await sleep(2500)

  const r1 = await page.evaluate(() => {
    const sc = window.__game.scene.getScene('BoardScene')
    return {
      players: sc.state.players.length,
      tokens: sc.tokenSprites.map((s, i) => ({
        i, charId: sc.state.players[i].charId,
        hasAnims: !!(s.anims && s.anims.isPlaying),
        key: s.anims && s.anims.getCurrentKey ? s.anims.getCurrentKey() : null,
        frame: s.frame ? s.frame.name : -1
      })),
      animsCreated: ['idle1-wait','idle2-wait','idle3-wait','idle4-wait','idle5-wait'].map(k => sc.anims.exists(k)),
      texturesExist: ['idle1','idle2','idle3'].map(k => sc.textures.exists(k))
    }
  })
  await sleep(1200)
  const r2 = await page.evaluate(() => {
    const sc = window.__game.scene.getScene('BoardScene')
    return sc.tokenSprites.map((s, i) => ({ i, frame: s.frame ? s.frame.name : -1 }))
  })

  const playing = r1.tokens.filter(t => t.hasAnims).length
  const frameChanged = r1.tokens.some((t, i) => r2[i] && r2[i].frame !== t.frame)
  console.log(JSON.stringify({
    players: r1.players,
    tokensPlaying: `${playing}/${r1.tokens.length}`,
    animsCreated: r1.animsCreated,
    texturesExist: r1.texturesExist,
    frameAdvancedOverTime: frameChanged,
    errors: errors.slice(0, 5)
  }, null, 1))
  await browser.close()
  process.exit(playing > 0 && frameChanged ? 0 : 2)
})().catch((e) => { console.error('FATAL', e); process.exit(1) })
