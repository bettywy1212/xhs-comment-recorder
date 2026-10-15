// 一个够用的 .xlsx 生成器：单个工作表，文字单元格，可以把 JPEG 图片嵌进指定单元格。
// .xlsx 本质是一个装着若干 XML 文件的 zip 包，这里用不压缩的方式直接打包，不依赖第三方库。
(function (root) {
  const enc = new TextEncoder();
  const EMU_PER_PX = 9525;

  // ---------- zip ----------
  const CRC_TABLE = (() => {
    const t = new Uint32Array(256);
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      t[n] = c >>> 0;
    }
    return t;
  })();

  function crc32(bytes) {
    let c = 0xffffffff;
    for (let i = 0; i < bytes.length; i++) c = CRC_TABLE[(c ^ bytes[i]) & 0xff] ^ (c >>> 8);
    return (c ^ 0xffffffff) >>> 0;
  }

  // files: [{ name, data: string | Uint8Array }] → Uint8Array
  function zip(files) {
    const chunks = [];
    const central = [];
    let offset = 0;
    for (const f of files) {
      const name = enc.encode(f.name);
      const data = typeof f.data === 'string' ? enc.encode(f.data) : f.data;
      const crc = crc32(data);

      const local = new Uint8Array(30 + name.length);
      const lv = new DataView(local.buffer);
      lv.setUint32(0, 0x04034b50, true);
      lv.setUint16(4, 20, true);
      lv.setUint16(6, 0x0800, true); // 文件名是 UTF-8
      lv.setUint16(12, 0x21, true); // 1980-01-01
      lv.setUint32(14, crc, true);
      lv.setUint32(18, data.length, true);
      lv.setUint32(22, data.length, true);
      lv.setUint16(26, name.length, true);
      local.set(name, 30);

      const cen = new Uint8Array(46 + name.length);
      const cv = new DataView(cen.buffer);
      cv.setUint32(0, 0x02014b50, true);
      cv.setUint16(4, 20, true);
      cv.setUint16(6, 20, true);
      cv.setUint16(8, 0x0800, true);
      cv.setUint16(14, 0x21, true);
      cv.setUint32(16, crc, true);
      cv.setUint32(20, data.length, true);
      cv.setUint32(24, data.length, true);
      cv.setUint16(28, name.length, true);
      cv.setUint32(42, offset, true);
      cen.set(name, 46);

      chunks.push(local, data);
      central.push(cen);
      offset += local.length + data.length;
    }
    const centralSize = central.reduce((n, c) => n + c.length, 0);
    const end = new Uint8Array(22);
    const ev = new DataView(end.buffer);
    ev.setUint32(0, 0x06054b50, true);
    ev.setUint16(8, files.length, true);
    ev.setUint16(10, files.length, true);
    ev.setUint32(12, centralSize, true);
    ev.setUint32(16, offset, true);

    const all = [...chunks, ...central, end];
    const out = new Uint8Array(all.reduce((n, c) => n + c.length, 0));
    let pos = 0;
    for (const c of all) {
      out.set(c, pos);
      pos += c.length;
    }
    return out;
  }

  // ---------- xlsx ----------
  function esc(s) {
    return String(s)
      .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f￾￿]/g, '') // XML 不允许的控制字符
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function colName(i) {
    let s = '';
    for (i += 1; i > 0; i = Math.floor((i - 1) / 26)) s = String.fromCharCode(65 + ((i - 1) % 26)) + s;
    return s;
  }

  const NS_MAIN = 'http://schemas.openxmlformats.org/spreadsheetml/2006/main';
  const NS_REL = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
  const NS_PKG_REL = 'http://schemas.openxmlformats.org/package/2006/relationships';
  const XML_HEAD = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n';

  const STYLES =
    XML_HEAD +
    `<styleSheet xmlns="${NS_MAIN}">` +
    '<fonts count="2"><font><sz val="12"/><name val="PingFang SC"/></font><font><b/><sz val="12"/><name val="PingFang SC"/></font></fonts>' +
    '<fills count="2"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill></fills>' +
    '<borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders>' +
    '<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>' +
    '<cellXfs count="3">' +
    '<xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>' +
    '<xf numFmtId="0" fontId="1" fillId="0" borderId="0" xfId="0" applyFont="1"/>' +
    '<xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0" applyAlignment="1"><alignment vertical="top" wrapText="1"/></xf>' +
    '</cellXfs>' +
    '<cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles>' +
    '</styleSheet>';

  function cellXml(ref, value, style) {
    if (value === '' || value == null) return '';
    if (typeof value === 'number' || (typeof value === 'string' && /^\d{1,15}$/.test(value))) {
      return `<c r="${ref}" s="${style}"><v>${Number(value)}</v></c>`;
    }
    return `<c r="${ref}" s="${style}" t="inlineStr"><is><t xml:space="preserve">${esc(value)}</t></is></c>`;
  }

  // 列宽（字符）换算成像素，和 Excel 的算法一致
  function colWidthPx(width) {
    return Math.trunc(width * 7 + 5);
  }

  // 估算一段文字在给定列宽下占几行：中文等全角字符按 2 个字符宽度算
  function lineCount(value, width) {
    if (value === '' || value == null) return 1;
    let lines = 0;
    for (const para of String(value).split('\n')) {
      let units = 0;
      for (const ch of para) units += ch.charCodeAt(0) > 0xff ? 2 : 1;
      lines += Math.max(1, Math.ceil(units / Math.max(1, width - 1)));
    }
    return lines;
  }

  // 像素高度向上取到 4 的倍数，换成磅（×0.75）时正好是整数，各软件算出的位置不会有累积误差
  function roundPx(px) {
    return Math.ceil(px / 4) * 4;
  }

  const LINE_PX = 20;
  const HEADER_PX = 24;
  const PAD_PX = 4;

  // 每张图片同时写两种位置：
  // - 单元格锚点（offX/offY 是在单元格内的偏移）：Excel、WPS、在线表格用它
  // - 绝对位置（x/y 是在整张表里的坐标）：Numbers 等苹果软件用它
  // 各软件换算列宽的方式不一样，绝对横坐标只在第一列（A 列）时才准，所以图片应放在 A 列
  function drawingXml(images) {
    const anchors = images
      .map((img, i) => {
        const cx = img.width * EMU_PER_PX;
        const cy = img.height * EMU_PER_PX;
        return (
          '<xdr:twoCellAnchor editAs="oneCell">' +
          `<xdr:from><xdr:col>${img.col}</xdr:col><xdr:colOff>${img.offX}</xdr:colOff><xdr:row>${img.sheetRow}</xdr:row><xdr:rowOff>${img.offY}</xdr:rowOff></xdr:from>` +
          `<xdr:to><xdr:col>${img.col}</xdr:col><xdr:colOff>${img.offX + cx}</xdr:colOff><xdr:row>${img.sheetRow}</xdr:row><xdr:rowOff>${img.offY + cy}</xdr:rowOff></xdr:to>` +
          `<xdr:pic><xdr:nvPicPr><xdr:cNvPr id="${i + 2}" name="图片 ${i + 1}"/><xdr:cNvPicPr><a:picLocks noChangeAspect="1"/></xdr:cNvPicPr></xdr:nvPicPr>` +
          `<xdr:blipFill><a:blip r:embed="rId${i + 1}"/><a:stretch><a:fillRect/></a:stretch></xdr:blipFill>` +
          `<xdr:spPr><a:xfrm><a:off x="${img.x * EMU_PER_PX}" y="${img.y * EMU_PER_PX}"/><a:ext cx="${cx}" cy="${cy}"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></xdr:spPr></xdr:pic>` +
          '<xdr:clientData/></xdr:twoCellAnchor>'
        );
      })
      .join('');
    return (
      XML_HEAD +
      '<xdr:wsDr xmlns:xdr="http://schemas.openxmlformats.org/drawingml/2006/spreadsheetDrawing" ' +
      `xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="${NS_REL}">` +
      anchors +
      '</xdr:wsDr>'
    );
  }

  /**
   * 生成 .xlsx
   * @param {object} opts
   * @param {string} opts.sheetName
   * @param {{header: string, width: number}[]} opts.columns  width 单位是字符宽度
   * @param {Array<Array<string|number>>} opts.rows          不含表头
   * @param {{row: number, col: number, data: Uint8Array, width: number, height: number, dx?: number, dy?: number}[]} [opts.images]
   *        row/col 从 0 开始，row 0 是第一行数据（表头之后）；width/height 是显示尺寸（像素）；
   *        dx/dy 是图片在单元格内的偏移（像素），用于同一格放多张图
   * @returns {Uint8Array}
   */
  function buildXlsx({ sheetName, columns, rows, images = [] }) {
    // 每一行都写死高度：按文字行数估算，有图片的行再撑到能放下图片。
    // 行高确定了，图片的绝对位置才算得准
    const imageHeight = new Map();
    for (const img of images) {
      imageHeight.set(img.row, Math.max(imageHeight.get(img.row) || 0, (img.dy || 0) + img.height + PAD_PX * 2));
    }
    const rowPx = rows.map((cells, ri) => {
      const lines = Math.max(1, ...cells.map((v, ci) => lineCount(v, columns[ci] ? columns[ci].width : 10)));
      return roundPx(Math.max(lines * LINE_PX + PAD_PX, imageHeight.get(ri) || 0));
    });

    const colLeft = [0];
    for (const c of columns) colLeft.push(colLeft[colLeft.length - 1] + colWidthPx(c.width));
    const rowTop = [HEADER_PX];
    for (const h of rowPx) rowTop.push(rowTop[rowTop.length - 1] + h);

    const placed = images.map((img) => {
      const offX = PAD_PX + (img.dx || 0);
      const offY = PAD_PX + (img.dy || 0);
      return {
        ...img,
        sheetRow: img.row + 1, // 第 0 行是表头
        offX: offX * EMU_PER_PX,
        offY: offY * EMU_PER_PX,
        x: colLeft[img.col] + offX,
        y: rowTop[img.row] + offY,
      };
    });

    const cols = columns.map((c, i) => `<col min="${i + 1}" max="${i + 1}" width="${c.width}" customWidth="1"/>`).join('');
    const headerRow = `<row r="1" ht="${HEADER_PX * 0.75}" customHeight="1">${columns.map((c, i) => cellXml(colName(i) + 1, c.header, 1)).join('')}</row>`;
    const dataRows = rows
      .map((cells, ri) => {
        const r = ri + 2;
        return `<row r="${r}" ht="${rowPx[ri] * 0.75}" customHeight="1">${cells.map((v, ci) => cellXml(colName(ci) + r, v, 2)).join('')}</row>`;
      })
      .join('');

    const hasImages = placed.length > 0;
    const sheet =
      XML_HEAD +
      `<worksheet xmlns="${NS_MAIN}" xmlns:r="${NS_REL}">` +
      '<sheetViews><sheetView workbookViewId="0"><pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews>' +
      `<sheetFormatPr defaultRowHeight="${LINE_PX * 0.75}"/>` +
      `<cols>${cols}</cols>` +
      `<sheetData>${headerRow}${dataRows}</sheetData>` +
      (hasImages ? '<drawing r:id="rId1"/>' : '') +
      '</worksheet>';

    const safeSheet = esc(String(sheetName || 'Sheet1').replace(/[\[\]:*?\/\\]/g, ' ').slice(0, 31) || 'Sheet1');

    const files = [
      {
        name: '[Content_Types].xml',
        data:
          XML_HEAD +
          '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">' +
          '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
          '<Default Extension="xml" ContentType="application/xml"/>' +
          '<Default Extension="jpeg" ContentType="image/jpeg"/>' +
          '<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>' +
          '<Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>' +
          '<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>' +
          (hasImages ? '<Override PartName="/xl/drawings/drawing1.xml" ContentType="application/vnd.openxmlformats-officedocument.drawing+xml"/>' : '') +
          '</Types>',
      },
      {
        name: '_rels/.rels',
        data: XML_HEAD + `<Relationships xmlns="${NS_PKG_REL}"><Relationship Id="rId1" Type="${NS_REL}/officeDocument" Target="xl/workbook.xml"/></Relationships>`,
      },
      {
        name: 'xl/workbook.xml',
        data: XML_HEAD + `<workbook xmlns="${NS_MAIN}" xmlns:r="${NS_REL}"><sheets><sheet name="${safeSheet}" sheetId="1" r:id="rId1"/></sheets></workbook>`,
      },
      {
        name: 'xl/_rels/workbook.xml.rels',
        data:
          XML_HEAD +
          `<Relationships xmlns="${NS_PKG_REL}">` +
          `<Relationship Id="rId1" Type="${NS_REL}/worksheet" Target="worksheets/sheet1.xml"/>` +
          `<Relationship Id="rId2" Type="${NS_REL}/styles" Target="styles.xml"/>` +
          '</Relationships>',
      },
      { name: 'xl/styles.xml', data: STYLES },
      { name: 'xl/worksheets/sheet1.xml', data: sheet },
    ];

    if (hasImages) {
      files.push(
        {
          name: 'xl/worksheets/_rels/sheet1.xml.rels',
          data: XML_HEAD + `<Relationships xmlns="${NS_PKG_REL}"><Relationship Id="rId1" Type="${NS_REL}/drawing" Target="../drawings/drawing1.xml"/></Relationships>`,
        },
        { name: 'xl/drawings/drawing1.xml', data: drawingXml(placed) },
        {
          name: 'xl/drawings/_rels/drawing1.xml.rels',
          data:
            XML_HEAD +
            `<Relationships xmlns="${NS_PKG_REL}">` +
            images.map((_, i) => `<Relationship Id="rId${i + 1}" Type="${NS_REL}/image" Target="../media/image${i + 1}.jpeg"/>`).join('') +
            '</Relationships>',
        },
        ...images.map((img, i) => ({ name: `xl/media/image${i + 1}.jpeg`, data: img.data }))
      );
    }
    return zip(files);
  }

  const api = { buildXlsx, zip, crc32 };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.XhsXlsx = api;
})(typeof self !== 'undefined' ? self : this);
