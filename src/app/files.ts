/** Offers text, or a Blob (an Export), as a file to save. */
export function download(filename: string, data: string | Blob, type = 'application/json') {
  const url = URL.createObjectURL(typeof data === 'string' ? new Blob([data], { type }) : data);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/** Asks the user for a file and reads it as text; null if they cancel. */
export function pickFile(accept = '.json,application/json'): Promise<string | null> {
  return new Promise((resolve) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = accept;
    input.addEventListener('change', async () =>
      resolve(input.files?.[0] ? await input.files[0].text() : null)
    );
    input.addEventListener('cancel', () => resolve(null));
    input.click();
  });
}

const clean = (name: string) => name.replace(/[^\w\- ]+/g, '').trim();

export const fileName = (name: string) => `${clean(name) || 'house'}.renoplan.json`;

/** An Export's file name: "Home - Option A.pdf". */
export const exportName = (project: string, view: string, ext: string) =>
  `${[clean(project) || 'house', clean(view)].filter(Boolean).join(' - ')}.${ext}`;
