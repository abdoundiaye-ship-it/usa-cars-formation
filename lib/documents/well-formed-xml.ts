/**
 * Contrôle minimal de la structure XML d'une partie de document Word (balises ouvertes et fermées dans l'ordre).
 * Un fichier mal formé ne s'ouvre pas dans Word : le script des modèles et les tests l'utilisent sur chaque partie.
 * Renvoie null si la structure est correcte, sinon la description de la première erreur.
 */
export function xmlStructureError(xml: string): string | null {
  const stack: string[] = [];
  const tag = /<(\/?)([A-Za-z_][\w:.-]*)(?:\s[^<>]*?)?(\/?)>|<\?[\s\S]*?\?>|<!--[\s\S]*?-->|<!\[CDATA\[[\s\S]*?\]\]>/g;
  for (const match of xml.matchAll(tag)) {
    const [, closing, name, selfClosing] = match;
    if (name === undefined || selfClosing) continue;
    if (!closing) {
      stack.push(name);
    } else if (stack.pop() !== name) {
      return `balise </${name}> inattendue à la position ${match.index}`;
    }
  }
  return stack.length > 0 ? `balise <${stack.at(-1)}> non fermée` : null;
}
