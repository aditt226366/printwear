const menuSelections: Record<string, { label: string; searchQuery: string; assistantMessage: string }> = {
  "1": {
    label: "T-Shirts",
    searchQuery: "Round Neck T-Shirts Polo Collar T-Shirts Oversized T-Shirts sizes colors gsm",
    assistantMessage:
      "Customer selected option 1: T-Shirts. Use the knowledge base to explain available T-Shirt options, including Round Neck, Polo/Collar, and Oversized T-Shirts. Ask for quantity, sizes, colors, GSM preference, customization requirement, and delivery location."
  },
  "2": {
    label: "Hoodies",
    searchQuery: "Hoodies sizes colors gsm customization",
    assistantMessage:
      "Customer selected option 2: Hoodies. Use the knowledge base to explain available Hoodie options. Ask for quantity, sizes, colors, customization requirement, and delivery location."
  },
  "3": {
    label: "Kids Wear",
    searchQuery: "Kids Wear Kids Collection sizes colors gsm customization",
    assistantMessage:
      "Customer selected option 3: Kids Wear. Use the knowledge base to explain available Kids Wear options. Ask for age group or size, quantity, colors, customization requirement, and delivery location."
  },
  "4": {
    label: "Custom Bulk Order",
    searchQuery: "custom bulk order apparel quantity product type sizes colors customization delivery",
    assistantMessage:
      "Customer selected option 4: Custom Bulk Order. Use the knowledge base to qualify the bulk order. Ask for product type, quantity, sizes, colors, GSM preference, customization requirement, and delivery location."
  }
};

export type MenuIntent = {
  label: string;
  searchQuery: string;
  assistantMessage: string;
};

export function resolveMenuIntent(message: string): MenuIntent | null {
  const normalized = message.trim().replace(/[^\d]/g, "");

  if (normalized.length !== 1) {
    return null;
  }

  return menuSelections[normalized] ?? null;
}
