import { z } from 'zod';

import type { RawToolSpec } from './spec.js';

export const GET_FONTS_TOOL_NAME = 'get_fonts';

export const getFontsTool: RawToolSpec = {
  name: GET_FONTS_TOOL_NAME,
  description:
    'Return every font used on the current page as { fonts: [{ fontName, count }] }, sorted by ' +
    'usage frequency (descending). Mixed-font text contributes one count per styled segment.',
  inputSchema: z.object({}),
  kind: 'read',
};
