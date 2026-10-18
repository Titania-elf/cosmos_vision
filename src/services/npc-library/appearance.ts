/** 对模型误带的常见服装/配饰做兜底过滤；语义边界仍由抽取提示词约束。 */
const WEARABLE_PATTERN =
  /\b(?:outfits?|clothes?|clothing|costumes?|uniforms?|dress(?:es)?|shirts?|blouses?|skirts?|pants|trousers|shorts|jeans|jackets?|coats?|robes?|capes?|cloaks?|hoodies?|sweaters?|suits?|armor|armour|underwear|bras?|panties|bikinis?|swimsuits?|lingerie|socks?|stockings?|pantyhose|thighhighs|shoes?|boots?|sandals?|heels?|gloves?|hats?|caps?|helmets?|hoods?|veils?|scarves|scarf|ties?|ribbons?|bows?|belts?|aprons?|glasses|eyewear|goggles|jewelry|jewellery|earrings?|necklaces?|bracelets?|rings?|chokers?|hair ornaments?|hair accessories|hairpins?|hairclips?|headbands?|headdress(?:es)?|crowns?|tiaras?|masks?|bags?|backpacks?|weapons?|swords?|guns?)\b|服装|服饰|衣服|连衣裙|裙子|衬衫|外套|制服|校服|盔甲|铠甲|裤|袜|鞋|靴|手套|帽子|围巾|领带|发饰|发夹|发簪|头饰|首饰|饰品|耳环|项链|手镯|戒指|眼镜|口罩|武器/i;

/** 两个外观字段都排除穿戴物，避免自然语言说明绕过标签规则。 */
export function sanitizeNpcAppearance(tags: string, note: string): { tags: string; note: string } {
  const normalizedTags = tags
    .split(/[,，\n]+/)
    .map(tag => tag.trim().toLowerCase().replace(/[_-]+/g, ' ').replace(/\s+/g, ' '))
    .filter(tag => tag && !WEARABLE_PATTERN.test(tag));
  const normalizedNote = note
    .split(/(?<=[.!?。！？；;])\s*|\n+/)
    .map(sentence => sentence.trim())
    .filter(sentence => sentence && !WEARABLE_PATTERN.test(sentence.replace(/[_-]+/g, ' ')))
    .join(' ');
  return { tags: [...new Set(normalizedTags)].join(', '), note: normalizedNote };
}
