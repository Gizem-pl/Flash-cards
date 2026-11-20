// Anki's built-in note types.
export const DEFAULT_CSS = `.card {
    font-family: arial;
    font-size: 20px;
    text-align: center;
    color: black;
    background-color: white;
}
`;
export const CLOZE_CSS = DEFAULT_CSS + `
.cloze {
    font-weight: bold;
    color: blue;
}
.nightMode .cloze {
    color: lightblue;
}
`;
export const LATEX_PRE = '\\documentclass[12pt]{article}\n\\special{papersize=3in,5in}\n\\usepackage[utf8]{inputenc}\n\\usepackage{amssymb,amsmath}\n\\pagestyle{empty}\n\\setlength{\\parindent}{0in}\n\\begin{document}\n';
export const LATEX_POST = '\\end{document}';

const SEP = '{{FrontSide}}\n\n<hr id=answer>\n\n';
const flds = (names) => names.map((name, ord) => ({ name, ord, sticky: false, rtl: false, font: 'Arial', size: 20, description: '' }));
const tmpl = (name, ord, qfmt, afmt) => ({ name, ord, qfmt, afmt, bqfmt: '', bafmt: '', did: null });
const nt = (id, name, type, fields, tmpls, css) => ({ id, name, type, flds: flds(fields), tmpls, css, sortf: 0, latexPre: LATEX_PRE, latexPost: LATEX_POST, mod: 0 });

export function stockNotetypes(base) {
  return [
    nt(base, 'Basic', 0, ['Front', 'Back'], [tmpl('Card 1', 0, '{{Front}}', SEP + '{{Back}}')], DEFAULT_CSS),
    nt(base + 1, 'Basic (and reversed card)', 0, ['Front', 'Back'], [
      tmpl('Card 1', 0, '{{Front}}', SEP + '{{Back}}'), tmpl('Card 2', 1, '{{Back}}', SEP + '{{Front}}')], DEFAULT_CSS),
    nt(base + 2, 'Basic (optional reversed card)', 0, ['Front', 'Back', 'Add Reverse'], [
      tmpl('Card 1', 0, '{{Front}}', SEP + '{{Back}}'), tmpl('Card 2', 1, '{{#Add Reverse}}{{Back}}{{/Add Reverse}}', SEP + '{{Front}}')], DEFAULT_CSS),
    nt(base + 3, 'Basic (type in the answer)', 0, ['Front', 'Back'], [
      tmpl('Card 1', 0, '{{Front}}\n\n{{type:Back}}', '{{Front}}\n\n<hr id=answer>\n\n{{type:Back}}')], DEFAULT_CSS),
    nt(base + 4, 'Cloze', 1, ['Text', 'Back Extra'], [tmpl('Cloze', 0, '{{cloze:Text}}', '{{cloze:Text}}<br>\n{{Back Extra}}')], CLOZE_CSS),
  ];
}
