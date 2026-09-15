import { PDFDocument } from 'pdf-lib';

export const mergeSinglePagePdfs = async (pages: readonly Uint8Array[]): Promise<Uint8Array> => {
  if (pages.length === 0 || pages.length > 256) throw new Error('PDF_PAGES_INVALID');
  const output = await PDFDocument.create();
  for (const [index, bytes] of pages.entries()) {
    // eslint-disable-next-line no-await-in-loop -- copy in caller order, never completion order
    const source = await PDFDocument.load(bytes, { ignoreEncryption: false });
    if (source.getPageCount() !== 1) throw new Error(`PDF_PAGE_COUNT_INVALID:${index}`);
    // eslint-disable-next-line no-await-in-loop -- one verified page contributes one output page
    const [page] = await output.copyPages(source, [0]);
    if (page === undefined) throw new Error('PDF_PAGE_COPY_FAILED');
    output.addPage(page);
  }
  return output.save();
};
