// 验证：岛屿资料卡 / 玩家档案 的排版不溢出（每个 Text 都落在面板内，面板不超出屏幕）
const { chromium } = require('playwright-core')
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
;(async () => {
  const b = await chromium.launch({ headless: true, executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome' })
  let fail = 0
  for (const [W, H] of [[1080, 610], [1280, 720], [900, 540]]) {
    const p = await b.newPage({ viewport: { width: W, height: H }, deviceScaleFactor: 1 })
    await p.goto('http://localhost:5173/index.html', { waitUntil: 'networkidle' })
    await sleep(1600)
    await p.evaluate(() => window.__game.scene.start('BoardScene', { autoPlay: false }))
    await sleep(2200)

    // --- 1) 岛屿资料卡：无主 / 有主 两种 ---
    for (const [label, setup] of [
      ['无主岛', () => {}],
      ['有主岛', () => {
        const s = window.__game.scene.getScene('BoardScene').state
        s.islandState[17] = { ownerId: 0, level: 3 }
        s.players[0].islandIds = [17, 18, 19, 20]
      }]
    ]) {
      const r = await p.evaluate(setup)
      void r
      await p.evaluate(() => {
        const sc = window.__game.scene.getScene('BoardScene')
        sc.closeIslandCard()
        sc.showIslandCard(sc.boardCX, sc.boardCY, sc.cell, 17)
      })
      await sleep(400)
      const res = await p.evaluate(() => {
        const sc = window.__game.scene.getScene('BoardScene')
        const lay = sc.islandCard
        const b = lay.getBounds()
        const bad = []
        for (const ch of lay.list) {
          if (ch.type !== 'Text' || !ch.text) continue
          const bb = ch.getBounds()
          if (bb.x < b.x - 1 || bb.x + bb.width > b.x + b.width + 1 || bb.y < b.y - 1 || bb.y + bb.height > b.y + b.height + 1) {
            bad.push({ text: ch.text.slice(0, 20), overR: Math.round(bb.x + bb.width - b.x - b.width), overB: Math.round(bb.y + bb.height - b.y - b.height) })
          }
        }
        const onScreen = b.x >= 0 && b.y >= 0 && b.x + b.width <= sc.W && b.y + b.height <= sc.H
        return { card: [Math.round(b.x), Math.round(b.y), Math.round(b.width), Math.round(b.height)], bad, onScreen }
      })
      const ok = res.bad.length === 0 && res.onScreen
      if (!ok) { fail++; console.log(`  ${W}x${H} 岛卡(${label}) FAIL`, JSON.stringify(res)) } else console.log(`  ${W}x${H} 岛卡(${label}) PASS card=${res.card.join(',')}`)
    }
    await p.evaluate(() => window.__game.scene.getScene('BoardScene').closeIslandCard())

    // --- 2) 玩家档案：自己 / 别人 / 岛屿写满 22 座 ---
    for (const [label, idx, fill] of [['自己', 0, false], ['别人', 1, true]]) {
      const res = await p.evaluate(({ idx, fill }) => {
        const sc = window.__game.scene.getScene('BoardScene')
        sc.closeCustomPanel()
        if (fill) {
          const s = sc.state
          const all = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22]
          s.players[1].islandIds = all
          s.players[1].hand = [{ kind: 'fruit', defId: 1 }, { kind: 'haki', defId: 1 }, { kind: 'history' }, { kind: 'fruit', defId: 3 }, { kind: 'history' }]
          all.forEach((id) => { s.islandState[id] = { ownerId: 1, level: 2 } })
        }
        sc.openPlayerInfo(idx)
        const root = sc.customPanel.root
        const texts = root.list.filter((o) => o.type === 'Text')
        // 面板矩形：makePanel 容器（root 第 2 个子节点）的 bounds 去掉外框 4px
        const panel = root.list.find((o) => o.type === 'Container')
        const pb = panel.getBounds()
        const bad = []
        for (const t of texts) {
          const bb = t.getBounds()
          if (bb.y + bb.height > pb.y + pb.height - 6 || bb.y < pb.y + 4 || bb.x < pb.x + 4 || bb.x + bb.width > pb.x + pb.width - 4) {
            bad.push({ text: t.text.slice(0, 18), bottom: Math.round(bb.y + bb.height - pb.y - pb.height), right: Math.round(bb.x + bb.width - pb.x - pb.width) })
          }
        }
        return { panel: [Math.round(pb.x), Math.round(pb.y), Math.round(pb.width), Math.round(pb.height)], texts: texts.length, bad }
      }, { idx, fill })
      const ok = res.bad.length === 0
      if (!ok) { fail++; console.log(`  ${W}x${H} 档案(${label}) FAIL`, JSON.stringify(res)) } else console.log(`  ${W}x${H} 档案(${label}) PASS panel=${res.panel.join(',')} texts=${res.texts}`)
    }
    await p.screenshot({ path: `/tmp/panels_${W}x${H}.png` })
    await p.close()
  }
  await b.close()
  console.log(fail === 0 ? 'ALL PASS' : `${fail} FAIL`)
  process.exit(fail === 0 ? 0 : 1)
})().catch((e) => { console.error(e); process.exit(1) })
