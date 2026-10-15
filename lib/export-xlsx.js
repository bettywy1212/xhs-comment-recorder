// 把一篇笔记的评论导出成带图片的 Excel：评论图片缩成缩略图，放在这条评论所在行的第一列“图片”里，
// 一行最多排 3 张。放在第一列是因为各表格软件换算列宽的方式不同，只有第一列的位置在所有软件里都一致。
(function (root) {
  const P = root.XhsParse;
  const X = root.XhsXlsx;

  // 缩略图在表格里显示的最大尺寸（像素）。实际按 2 倍分辨率保存，放大看也清楚
  const THUMB_W = 110;
  const THUMB_H = 110;
  const GRID_COLS = 3;
  const GAP = 4;
  const CONCURRENCY = 4;

  async function loadThumb(url) {
    const res = await fetch(url, { credentials: 'omit', referrerPolicy: 'no-referrer' });
    if (!res.ok) throw new Error('HTTP ' + res.status);
    const bitmap = await createImageBitmap(await res.blob());
    const show = Math.min(1, THUMB_W / bitmap.width, THUMB_H / bitmap.height);
    const keep = Math.min(1, show * 2);
    const w = Math.max(1, Math.round(bitmap.width * keep));
    const h = Math.max(1, Math.round(bitmap.height * keep));
    const showW = Math.max(1, Math.round(bitmap.width * show));
    const showH = Math.max(1, Math.round(bitmap.height * show));
    // 统一转成 JPEG：小红书的图片多是 webp，Excel 不认识 webp
    const canvas = new OffscreenCanvas(w, h);
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#fff';
    ctx.fillRect(0, 0, w, h);
    ctx.drawImage(bitmap, 0, 0, w, h);
    bitmap.close();
    const blob = await canvas.convertToBlob({ type: 'image/jpeg', quality: 0.85 });
    return {
      data: new Uint8Array(await blob.arrayBuffer()),
      width: showW,
      height: showH,
    };
  }

  // 有限并发地跑一组任务
  async function pool(items, limit, worker) {
    let next = 0;
    const run = async () => {
      while (next < items.length) {
        const i = next++;
        await worker(items[i], i);
      }
    };
    await Promise.all(Array.from({ length: Math.min(limit, items.length) }, run));
  }

  /**
   * @param {object} note
   * @param {(done: number, total: number) => void} [onProgress]
   * @returns {Promise<{ bytes: Uint8Array, total: number, failed: number }>}
   */
  async function noteToXlsx(note, onProgress) {
    const rows = P.commentRows(note);
    const maxPerRow = Math.max(0, ...rows.map(({ r }) => (r.images || []).length));
    const hasImageCol = maxPerRow > 0;

    // 图片列的宽度按“一行最多几张”来定，换算成 Excel 的字符宽度（约 7 像素一个字符）
    const gridCols = Math.min(GRID_COLS, maxPerRow);
    const imageColPx = gridCols * (THUMB_W + GAP) + GAP * 2;
    const widths = { 楼层: 6, 类型: 6, 用户名: 14, 内容: 40, 点赞数: 8, 时间: 19, 回复对象: 14, IP属地: 8 };
    const columns = [
      ...(hasImageCol ? [{ header: '图片', width: Math.ceil((imageColPx - 5) / 7) + 1 }] : []),
      ...P.BASE_HEADER.map((h) => ({ header: h, width: widths[h] || 12 })),
      { header: '图片链接', width: 30 },
      { header: '评论ID', width: 26 },
      { header: '所属一级评论ID', width: 26 },
    ];
    const LINKS_COL = columns.length - 3;

    const table = rows.map(({ r, values }) => [
      ...(hasImageCol ? [''] : []),
      ...values,
      (r.images || []).join('\n'),
      r.id,
      r.parentId,
    ]);

    const jobs = [];
    rows.forEach(({ r }, row) => (r.images || []).forEach((url, index) => jobs.push({ url, row, index })));

    const loaded = [];
    const failedByRow = new Map();
    let done = 0;
    if (onProgress) onProgress(0, jobs.length);
    await pool(jobs, CONCURRENCY, async (job) => {
      try {
        loaded.push({ ...(await loadThumb(job.url)), row: job.row, index: job.index });
      } catch (err) {
        failedByRow.set(job.row, (failedByRow.get(job.row) || 0) + 1);
        console.warn('[小红书评论记录器] 图片加载失败', job.url, err);
      }
      done++;
      if (onProgress) onProgress(done, jobs.length);
    });

    for (const [row, n] of failedByRow) table[row][LINKS_COL] = `（${n} 张图片加载失败）\n` + table[row][LINKS_COL];

    // 按原顺序在格子里排成网格：每行 GRID_COLS 张
    loaded.sort((a, b) => a.row - b.row || a.index - b.index);
    const images = [];
    let slot = 0;
    loaded.forEach((img, i) => {
      slot = i > 0 && loaded[i - 1].row === img.row ? slot + 1 : 0;
      images.push({
        ...img,
        col: 0,
        dx: (slot % GRID_COLS) * (THUMB_W + GAP),
        dy: Math.floor(slot / GRID_COLS) * (THUMB_H + GAP),
      });
    });

    const failed = [...failedByRow.values()].reduce((n, v) => n + v, 0);
    const bytes = X.buildXlsx({ sheetName: '评论', columns, rows: table, images });
    return { bytes, total: jobs.length, failed };
  }

  root.XhsExport = { noteToXlsx };
})(self);
