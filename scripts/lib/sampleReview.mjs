const escape = (value) => String(value).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c])

/** 持ち運べる確認用一覧。リンク先のHTMLも素材を同梱し、ネットワークを必要としない。 */
export function sampleReviewIndex(reports, screenshots) {
  return `<!doctype html>
<html lang="ja"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>tobidas · 022 実験版サンプル</title>
<style>
*{box-sizing:border-box}body{margin:0;background:#f4f0e7;color:#302c25;font:16px/1.7 system-ui,sans-serif}main{max-width:1120px;margin:auto;padding:48px 24px}h1{font-size:32px;line-height:1.3}h2{font-size:20px;margin:0 0 4px}p{margin:8px 0 20px}a{color:#315d77;text-underline-offset:4px}nav{display:flex;gap:20px;flex-wrap:wrap}.grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(300px,1fr));gap:24px}article{border:1px solid #d7d0c2;border-radius:12px;background:#fffdf8;overflow:hidden}.body{padding:20px}img{width:100%;aspect-ratio:1.6;object-fit:cover;display:block;background:#ded7c7}.play{display:inline-block;background:#315d77;color:white;border-radius:6px;padding:8px 18px;text-decoration:none}.small{font-size:14px;color:#6e6557}footer{margin-top:36px;border-top:1px solid #d7d0c2;padding-top:20px}
</style>
<main><div class="small">tobidas / 022</div><h1>紙に接続する、動く絵本。</h1>
<p>紙の支持と折り方を組み直した4作品の実験版です。再生ボタンでページが進みます。</p>
<div class="grid">${reports.map((report) => {
    const id = report.projectId.slice(4)
    return `<article>${screenshots ? `<a href="${id}.html"><img src="screenshots/${report.projectId}-s1-p05.png" alt="${escape(report.title)}の見開き"></a>` : ''}<div class="body"><h2>${escape(report.title)}</h2><p class="small">${report.spreadCount}見開き</p><nav><a class="play" href="${id}.html">絵本を開く</a><a href="${report.projectId}.tobidas.zip" download>編集用ZIP</a></nav></div></article>`
  }).join('\n')}</div>
<footer><p>再編集するときは、tobidasの「作品ZIPを開く」で読み込んでください。元の作品フォルダーは変更していません。</p>
<nav><a href="migration-report.json">移行と検証の記録</a><a href="022-paper-windmill.tobidas-part.zip" download>回る羽根付き風車</a><a href="022-seasonal-room.tobidas-part.zip" download>四季の窓の部屋</a></nav>
<p class="small">部品ZIPは「カスタム部品を編集」の「読み込み」から利用できます。</p></footer></main></html>`
}
