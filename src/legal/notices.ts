/** Open-source components bundled with Kinora (shown under Settings → Third-party notices). */
export interface Notice {
  name: string;
  license: string;
  copyright: string;
}

export const THIRD_PARTY: Notice[] = [
  { name: 'Preact', license: 'MIT', copyright: 'Copyright (c) 2015-present Jason Miller' },
  { name: '@preact/signals', license: 'MIT', copyright: 'Copyright (c) 2022-present Preact Team' },
  {
    name: 'Lucide icons',
    license: 'ISC',
    copyright: 'Copyright (c) 2026 Lucide Icons and Contributors',
  },
  { name: 'three.js', license: 'MIT', copyright: 'Copyright © 2010-2026 three.js authors' },
  {
    name: 'meshoptimizer decoder',
    license: 'MIT',
    copyright: 'Copyright (C) 2016-2026, Arseny Kapoulkine',
  },
  { name: 'fflate', license: 'MIT', copyright: 'Copyright (c) 2026 Arjun Barrett' },
  {
    name: 'Mediabunny',
    license: 'MPL-2.0 (unmodified; source at https://github.com/Vanilagy/mediabunny)',
    copyright: 'Copyright (c) Vanilagy and contributors',
  },
  {
    name: 'Fonts: Inter, Poppins, Montserrat, Bebas Neue, Anton, Playfair Display, DM Serif Display, Lobster, Pacifico, Dancing Script, Caveat, Fredoka, Bangers, Permanent Marker, Space Mono',
    license: 'SIL Open Font License 1.1',
    copyright: 'Copyright their respective authors (see fonts/LICENSE.md)',
  },
  {
    name: 'Electron (desktop app only)',
    license: 'MIT',
    copyright: 'Copyright (c) Electron contributors; Chromium licenses are included with the app',
  },
];

export const MIT_TEXT = `Permission is hereby granted, free of charge, to any person obtaining a copy of this software and associated documentation files (the "Software"), to deal in the Software without restriction, including without limitation the rights to use, copy, modify, merge, publish, distribute, sublicense, and/or sell copies of the Software, and to permit persons to whom the Software is furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.`;

export const ISC_TEXT = `Permission to use, copy, modify, and/or distribute this software for any purpose with or without fee is hereby granted, provided that the above copyright notice and this permission notice appear in all copies.

THE SOFTWARE IS PROVIDED "AS IS" AND THE AUTHOR DISCLAIMS ALL WARRANTIES WITH REGARD TO THIS SOFTWARE INCLUDING ALL IMPLIED WARRANTIES OF MERCHANTABILITY AND FITNESS. IN NO EVENT SHALL THE AUTHOR BE LIABLE FOR ANY SPECIAL, DIRECT, INDIRECT, OR CONSEQUENTIAL DAMAGES OR ANY DAMAGES WHATSOEVER RESULTING FROM LOSS OF USE, DATA OR PROFITS, WHETHER IN AN ACTION OF CONTRACT, NEGLIGENCE OR OTHER TORTIOUS ACTION, ARISING OUT OF OR IN CONNECTION WITH THE USE OR PERFORMANCE OF THIS SOFTWARE.`;
