const XML_ESCAPES = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' };

export const escapeXml = (value) => String(value).replace(/[&<>"']/g, (char) => XML_ESCAPES[char]);

export const MIMETYPE = 'application/epub+zip';

export const CONTAINER_XML = `<?xml version="1.0" encoding="UTF-8"?>
<container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container">
  <rootfiles>
    <rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/>
  </rootfiles>
</container>
`;

export const STYLE_CSS = `@page { margin: 0; }
html, body { margin: 0; padding: 0; width: 100%; height: 100%; background: #fff; }
.page { width: 100%; height: 100%; text-align: center; }
.page img { display: block; margin: 0 auto; width: 100%; height: 100%; object-fit: contain; }
`;

export function pageXhtml(page, number) {
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE html>
<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops">
<head>
  <title>${number}</title>
  <meta name="viewport" content="width=${page.width}, height=${page.height}"/>
  <link rel="stylesheet" type="text/css" href="style.css"/>
</head>
<body>
  <div class="page"><img src="${page.image}" width="${page.width}" height="${page.height}" alt=""/></div>
</body>
</html>
`;
}

function manifestItems(pages) {
  return pages
    .map((page, i) => {
      const cover = i === 0 ? ' properties="cover-image"' : '';
      return [
        `    <item id="${page.imageId}" href="${page.image}" media-type="${page.mime}"${cover}/>`,
        `    <item id="${page.id}" href="${page.xhtml}" media-type="application/xhtml+xml"/>`,
      ].join('\n');
    })
    .join('\n');
}

export function packageOpf(meta, pages) {
  const author = meta.author ? `\n    <dc:creator>${escapeXml(meta.author)}</dc:creator>` : '';
  const spine = pages.map((page) => `    <itemref idref="${page.id}"/>`).join('\n');
  return `<?xml version="1.0" encoding="UTF-8"?>
<package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="uid" prefix="rendition: http://www.idpf.org/vocab/rendition/#">
  <metadata xmlns:dc="http://purl.org/dc/elements/1.1/">
    <dc:identifier id="uid">${escapeXml(meta.uid)}</dc:identifier>
    <dc:title>${escapeXml(meta.title)}</dc:title>${author}
    <dc:language>${escapeXml(meta.lang)}</dc:language>
    <meta property="dcterms:modified">${escapeXml(meta.modified)}</meta>
    <meta property="rendition:layout">pre-paginated</meta>
    <meta property="rendition:orientation">auto</meta>
    <meta property="rendition:spread">none</meta>
    <meta name="cover" content="${pages[0].imageId}"/>
  </metadata>
  <manifest>
    <item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/>
    <item id="ncx" href="toc.ncx" media-type="application/x-dtbncx+xml"/>
    <item id="css" href="style.css" media-type="text/css"/>
${manifestItems(pages)}
  </manifest>
  <spine toc="ncx" page-progression-direction="${meta.rtl ? 'rtl' : 'ltr'}">
${spine}
  </spine>
</package>
`;
}

export function navXhtml(meta, toc) {
  const items = toc.map((entry) => `      <li><a href="${entry.href}">${escapeXml(entry.title)}</a></li>`).join('\n');
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE html>
<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops" lang="${escapeXml(meta.lang)}">
<head><title>${escapeXml(meta.title)}</title></head>
<body>
  <nav epub:type="toc" id="toc">
    <ol>
${items}
    </ol>
  </nav>
</body>
</html>
`;
}

export function tocNcx(meta, toc) {
  const points = toc
    .map(
      (entry, i) => `    <navPoint id="nav${i + 1}" playOrder="${i + 1}">
      <navLabel><text>${escapeXml(entry.title)}</text></navLabel>
      <content src="${entry.href}"/>
    </navPoint>`,
    )
    .join('\n');
  return `<?xml version="1.0" encoding="UTF-8"?>
<ncx xmlns="http://www.daisy.org/z3986/2005/ncx/" version="2005-1">
  <head>
    <meta name="dtb:uid" content="${escapeXml(meta.uid)}"/>
    <meta name="dtb:depth" content="1"/>
    <meta name="dtb:totalPageCount" content="0"/>
    <meta name="dtb:maxPageNumber" content="0"/>
  </head>
  <docTitle><text>${escapeXml(meta.title)}</text></docTitle>
  <navMap>
${points}
  </navMap>
</ncx>
`;
}
