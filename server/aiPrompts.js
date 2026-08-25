function joinList(values) {
  return Array.isArray(values) && values.length ? values.join(', ') : 'Not specified';
}

function buildWineStyleNotesPrompt({ region, wineStyle, relatedWines }) {
  const relatedWineNames = Array.isArray(relatedWines)
    ? relatedWines.map((wine) => wine.name).filter(Boolean)
    : [];

  return [
    'You are writing notes for a personal wine atlas application.',
    'Write concise, accurate notes for the wine style below.',
    'The summary should include:',
    'A one sentence summary that gives an overview of the wine style with reference to region, important other points',
    'e.g. a distinctive Georgian dry white that...',
    'Dont say "Summary:"',
    'then, Grapes: - what are the main grapes used in the style',
    'Tasting Profile: - what are the typical flavours',
    'Also cover what the style is known for in this region, structure, and what makes the regional expression distinctive.',
    'If relevant also cover what differentiates this wine style from others in the region (e.g. Rioja Crianza vs Reserva).',
    'Do not mention that you are an AI.',
    'Use only plain text, not markdown.',
    '',
    `Region: ${region.name}`,
    `Country: ${region.country}`,
    `Wine style: ${wineStyle.name}`,
  ].join('\n');
}

function buildWineNotesPrompt({ region, wine, linkedWineStyle }) {
  const tastingCount = Array.isArray(wine.tastings) ? wine.tastings.length : 0;

  return [
    'You are writing notes for a personal wine atlas application.',
    'Write concise, accurate notes for the specific wine below.',
    'Use only plain text, not markdown.',
    'Do not mention that you are an AI.',
    'Cover what the wine is, likely style and structure, typical flavour profile, and why it is notable in this region.',
    'If a linked wine style is provided, use it to ground the description.',
    'Keep it concise and useful for a personal cellar record.',
    '',
    `Region: ${region.name}`,
    `Country: ${region.country}`,
    `Wine: ${wine.name}`,
  ].join('\n');
}

function buildWineImagePrompt({ region, wine, linkedWineStyle, hasReferenceImage = false, referenceImageNotes = '' }) {
  return [
    'Create a photorealistic product image of a single wine bottle.',
    'The bottle should be upright, centered, and fully visible.',
    hasReferenceImage
      ? 'Use the supplied reference image as the guide for the label, bottle shape, glass colour, and closure. Clean it up into a tidy full-bottle studio product image.'
      : 'Use the correct bottle shape, glass colour, and closure style for the wine if it can be inferred.',
    hasReferenceImage
      ? 'Keep the visible label design consistent with the reference image where possible.'
      : 'Search for the wine online and find the actual label.',
    'If the real commercial label is not found, approximate it closely; otherwise create a believable premium label using the wine name and origin.',
    'No hands, no glassware, no people, no tasting scene.',
    'Use a clean, neutral studio background and keep the label readable.',
    'The output should look like a realistic bottle photo for a cellar app.',
    '',
    `Region: ${region.name}`,
    `Country: ${region.country}`,
    `Climate: ${region.climate || 'Unknown'}`,
    `Wine: ${wine.name}`,
    `Linked wine style: ${linkedWineStyle?.name || 'None'}`,
    `Wine notes: ${wine.notes || 'None'}`,
    `Reference image notes: ${referenceImageNotes || 'None'}`
  ].join('\n');
}

function buildWineStyleExamplesPrompt({ region, wineStyle, existingWines }) {
  const existingNames = Array.isArray(existingWines)
    ? existingWines.map((wine) => wine.name).filter(Boolean).join(', ')
    : 'None';

  return [
    'Find up to 5 real examples of this wine style.',
    'Prioritise wines that are currently available in the UK, especially from supermarkets, Majestic, Waitrose, Tesco, Sainsbury\'s, M&S, The Wine Society, or similar mainstream UK retailers.',
    'Only include wines that are generally considered good or very good examples of the style and have solid reviews or strong reputation.',
    'Do not include anything already in the existing examples list.',
    'If you cannot find any good examples that meet the criteria, return an empty examples array and explain why briefly.',
    'Return strict JSON only with this shape:',
    '{"summary":"string","examples":[{"name":"string","notes":"string"}]}',
    'Notes should be one short plain-text sentence mentioning why it is a good example and where it is commonly available in the UK when known.',
    'Do not use markdown.',
    '',
    `Region: ${region.name}`,
    `Country: ${region.country}`,
    `Wine style: ${wineStyle.name}`,
    `Existing wine style notes: ${wineStyle.notes || 'None'}`,
    `Existing linked examples: ${existingNames}`
  ].join('\n');
}

function buildFastAddFromPhotoPrompt({ regions }) {
  const regionLines = Array.isArray(regions)
    ? regions.map((region) => `- ${region.name} (${region.country})`).join('\n')
    : '';

  return [
    'You are extracting structured wine-cellar data from one or more user-uploaded wine label photos.',
    'Read the images carefully and return the best possible structured proposal.',
    'Prefer what is actually visible in the photos. Do not invent facts.',
    'If a field is not visible or cannot be inferred with reasonable confidence, return an empty string for text fields or 0 for tastingRating.',
    'Use YYYY-MM-DD for tastingDate only if a full date is visible in the photos. Otherwise return an empty string.',
    'wineName should be the user-facing bottle name that should be stored in the app.',
    'wineStyleName should be the recognised style for this region when possible, such as Rioja Reserva, Clare Valley Riesling, Chablis, Vinho Verde, etc.',
    'regionName and countryName should match the label as closely as possible.',
    'wineNotes should be concise plain text useful for the wine record.',
    'tastingNotes should be concise plain text about what can be observed from the photos, provenance, vintage, cues from labels, or other useful intake notes.',
    'confidenceSummary should briefly explain how confident you are and mention any important uncertainty.',
    'Return strict JSON only with this exact shape:',
    '{"wineName":"string","producer":"string","regionName":"string","countryName":"string","wineStyleName":"string","vintage":"string","tastingDate":"string","tastingPrice":"string","tastingRating":0,"wineNotes":"string","tastingNotes":"string","confidenceSummary":"string"}',
    '',
    'Known atlas regions:',
    regionLines || '- None supplied'
  ].join('\n');
}

function buildRegionCreationPrompt({ country, regionName }) {
  return [
    'You are enriching a wine region entry for a personal wine atlas.',
    'Use web research to return concise, accurate structured data for the region.',
    'Do not invent facts.',
    'Return strict JSON only with this exact shape:',
    '{"description":"string","climate":"string","grapes":["string"],"styles":["string"],"facts":["string"],"wineStyles":["string"]}',
    'description should be 1 to 2 sentences.',
    'climate should be short, e.g. Cool maritime, Warm Mediterranean, Continental, etc.',
    'grapes should list key grapes associated with the region.',
    'styles should list broad wine styles associated with the region.',
    'facts should be 3 to 5 short atlas notes.',
    'wineStyles should list up to 5 specific wine styles strongly associated with the region.',
    '',
    `Country: ${country}`,
    `Region name: ${regionName}`
  ].join('\n');
}

module.exports = {
  buildWineStyleNotesPrompt,
  buildWineNotesPrompt,
  buildWineImagePrompt,
  buildWineStyleExamplesPrompt,
  buildFastAddFromPhotoPrompt,
  buildRegionCreationPrompt
};
