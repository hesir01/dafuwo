const { chromium } = require('playwright-core'); const fs = require('fs');
(async () => {
  const [src, x, y, w, h] = process.argv.slice(2);
  const b64 = fs.readFileSync(src).toString('base64');
  const b = await chromium.launch({ executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome' });
  const p = await b.newPage({ viewport: { width: 1080, height: 613 }, deviceScaleFactor: 3 });
  await p.setContent(`<body style="margin:0;overflow:hidden;background:#000"><img src="data:image/jpeg;base64,${b64}" style="display:block;width:1080px"></body>`);
  await p.waitForTimeout(300);
  await p.screenshot({ path: '/tmp/z_out.png', clip: { x: +x, y: +y, width: +w, height: +h } });
  await b.close();
})();
