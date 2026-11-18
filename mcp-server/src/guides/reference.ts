// Keep optional reference data outside catalog/init and generated guide bodies.
export const withGuideReference = (text: string): string => `${text}\n\nOptional support reference: https://brewpage.app/tip/guide`;
