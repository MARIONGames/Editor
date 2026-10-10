/**
 * End User License Agreement. Shown (and accepted) on first use; changing the text means
 * bumping EULA_VERSION, which asks everyone to accept again.
 *
 * build/eula.txt (shown by the Windows installer) is generated from this file — a unit
 * test checks the two never drift apart.
 */

export const COPYRIGHT = '© 2026 Marios Kouretis. All rights reserved.';
export const LICENSOR = 'Marios Kouretis';
export const EULA_VERSION = '2026-10-10';

export interface EulaSection {
  title: string;
  paragraphs: string[];
}

export const EULA_TITLE = 'Kinora End User License Agreement';

export const EULA: EulaSection[] = [
  {
    title: '1. About this agreement',
    paragraphs: [
      `This End User License Agreement (“Agreement”) is between you and ${LICENSOR} (“we”, “us”), the author and owner of Kinora, including the web app, the desktop apps, the optional online account service and all related files (together, the “Software”).`,
      'By installing, opening or using the Software you agree to this Agreement. If you do not agree, do not use the Software.',
    ],
  },
  {
    title: '2. Your license',
    paragraphs: [
      'We give you a personal, non-exclusive, non-transferable, revocable license to install and use the Software on devices you own or control, for personal and commercial purposes, as long as you follow this Agreement.',
      'The Software is licensed, not sold. We keep all rights, title and interest in the Software, including its code, design, name and logo.',
    ],
  },
  {
    title: '3. What you make is yours',
    paragraphs: [
      'You own the photos, videos, 3D models and other content you create or import with the Software (“Your Content”). We claim no ownership of Your Content and need no license to it, except the limited permission described in section 5 to store it for you if you turn on cloud backup.',
      'You are responsible for having the rights to everything you import, edit and publish, including music, images, fonts and models made by others.',
    ],
  },
  {
    title: '4. What you may not do',
    paragraphs: [
      'You may not: copy, sell, rent, lend, sublicense or redistribute the Software; modify it or create derivative works of it; decompile, disassemble or reverse engineer it, except where the law allows this despite this restriction; remove or change any copyright or license notice; use the Software to create or share content that is illegal or infringes the rights of others; or attempt to disrupt, overload or gain unauthorized access to the account service or other users’ data.',
    ],
  },
  {
    title: '5. Optional account and cloud backup',
    paragraphs: [
      'The Software works without an account, including offline. An account is optional. If you create one, you must give accurate information and keep your password secret; you are responsible for activity under your account.',
      'If you turn on cloud backup, you permit us to store and transmit Your Content and project files only to back them up and make them available on your devices. We do not use Your Content for any other purpose.',
      'You can delete your account at any time in the app; this deletes your cloud backups. Storage limits apply. The online service may change, be interrupted or end; please keep your own copies of important work.',
    ],
  },
  {
    title: '6. Privacy',
    paragraphs: [
      'Without an account, your projects and files stay on your device and are not sent to us. The Software shows no ads and contains no tracking.',
      'With an account, we store your email address, display name, a protected (hashed) form of your password and, if you use cloud backup, your backed-up projects. We do not sell this information and only share it when required by law.',
    ],
  },
  {
    title: '7. Third-party components',
    paragraphs: [
      'The Software includes open-source components (such as fonts, icons and libraries) that are provided under their own licenses. Those licenses apply to those components and are listed in the third-party notices that come with the Software.',
    ],
  },
  {
    title: '8. Updates and changes',
    paragraphs: [
      'We may update the Software and this Agreement. When this Agreement changes, the Software will ask you to accept the new version before you continue using it.',
    ],
  },
  {
    title: '9. No warranty',
    paragraphs: [
      'The Software is provided “as is” and “as available”, without warranties of any kind, whether express or implied, including merchantability, fitness for a particular purpose and non-infringement, to the fullest extent permitted by law. We do not promise that the Software will be error-free or that no data will ever be lost.',
    ],
  },
  {
    title: '10. Limitation of liability',
    paragraphs: [
      'To the fullest extent permitted by law, we are not liable for any indirect, incidental, special or consequential damages, or for loss of data, profits or business, arising from your use of the Software. Our total liability for any claim is limited to the amount you paid for the Software, if any.',
      'Nothing in this Agreement limits rights you have as a consumer that cannot be limited by contract under the law of the country where you live.',
    ],
  },
  {
    title: '11. Ending this agreement',
    paragraphs: [
      'This Agreement lasts until it ends. It ends automatically if you break it. When it ends you must stop using the Software and delete your copies. Sections 3, 9, 10 and 12 continue after it ends.',
    ],
  },
  {
    title: '12. General',
    paragraphs: [
      'This Agreement is governed by the laws of the country where the licensor resides, without prejudice to the mandatory rules that protect consumers where you live. If any part of this Agreement cannot be enforced, the rest stays in effect. This Agreement is the entire agreement between you and us about the Software.',
      `Kinora ${COPYRIGHT}`,
    ],
  },
];

/**
 * Plain-text version for the Windows installer's license page. ASCII only, so it reads
 * correctly whatever code page the installer uses.
 */
export function eulaPlainText(): string {
  const lines = [EULA_TITLE, `Version ${EULA_VERSION}`, ''];
  for (const s of EULA) {
    lines.push(s.title, '');
    for (const p of s.paragraphs) lines.push(p, '');
  }
  const text = `${lines.join('\r\n').trimEnd()}\r\n`;
  return text
    .replace(/[“”]/g, '"')
    .replace(/[‘’]/g, "'")
    .replace(/[–—]/g, '-')
    .replace(/©/g, '(c)')
    .replace(/…/g, '...');
}

const KEY = 'kinora.eula';

export function eulaAccepted(): boolean {
  try {
    return localStorage.getItem(KEY) === EULA_VERSION;
  } catch {
    // Storage blocked (private mode, sandboxed frame): ask every time rather than never.
    return sessionAccepted;
  }
}

let sessionAccepted = false;

export function acceptEula(): void {
  sessionAccepted = true;
  try {
    localStorage.setItem(KEY, EULA_VERSION);
    localStorage.setItem(`${KEY}.at`, new Date().toISOString());
  } catch {
    /* remembered for this session only */
  }
}
