// 把一篇笔记的评论导出成带图片的 Excel：每张评论图片缩成缩略图，放在这条评论所在行的“图片”列里。
(function (root) {
  const P = root.XhsParse;
  const X = root.XhsXlsx;

  // 缩略图在表格里显示的最大尺寸（像素）。实际按 2 倍分辨率保存，放大看也清楚
  const THUMB_W = 160;
  const THUMB_H = 120;
  const MAX_IMAGE_COLS = 9;
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
    const imageCols = Math.min(MAX_IMAGE_COLS, Math.max(0, ...rows.map(({ r }) => (r.images || []).length)));
    const base = P.BASE_HEADER.length;

    const widths = { 楼层: 6, 类型: 6, 用户名: 16, 内容: 50, 点赞数: 8, 时间: 19, 回复对象: 14, IP属地: 8 };
    const columns = [
      ...P.BASE_HEADER.map((h) => ({ header: h, width: widths[h] || 12 })),
      ...Array.from({ length: imageCols }, (_, i) => ({ header: imageCols > 1 ? `图片${i + 1}` : '图片', width: 24 })),
      { header: '图片链接', width: 30 },
      { header: '评论ID', width: 26 },
      { header: '所属一级评论ID', width: 26 },
    ];

    const table = rows.map(({ r, values }) => [
      ...values,
      ...Array(imageCols).fill(''),
      (r.images || []).join('\n'),
      r.id,
      r.parentId,
    ]);

    const jobs = [];
    rows.forEach(({ r }, row) => (r.images || []).slice(0, imageCols).forEach((url, i) => jobs.push({ url, row, col: base + i })));

    const images = [];
    let done = 0;
    let failed = 0;
    if (onProgress) onProgress(0, jobs.length);
    await pool(jobs, CONCURRENCY, async (job) => {
      try {
        images.push({ ...(await loadThumb(job.url)), row: job.row, col: job.col });
      } catch (err) {
        failed++;
        table[job.row][job.col] = '图片加载失败，见“图片链接”列';
        console.warn('[小红书评论记录器] 图片加载失败', job.url, err);
      }
      done++;
      if (onProgress) onProgress(done, jobs.length);
    });

    images.sort((a, b) => a.row - b.row || a.col - b.col);
    const bytes = X.buildXlsx({ sheetName: '评论', columns, rows: table, images });
    return { bytes, total: jobs.length, failed };
  }

  root.XhsExport = { noteToXlsx };
})(self);
