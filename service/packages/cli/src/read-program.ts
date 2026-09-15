import { BrowserReadQuerySchema } from '../../shared/src/figma-capture-query.js';
import { readFigmaCapture } from '../../shared/src/figma-capture-read.js';
export { BrowserReadQuerySchema } from '../../shared/src/figma-capture-query.js';
/** Serialize only the closed compiled reader with schema-validated data. */
export const createFigmaReadProgram = (input: unknown): string => {
  const query = BrowserReadQuerySchema.parse(input);
  return '(' + readFigmaCapture.toString() + ')(' + JSON.stringify(query) + ', figma)';
};
