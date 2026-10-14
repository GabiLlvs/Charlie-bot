const REPLIES = [
  "Flaquito de a uno que no soy pulpo 🐙",
  "De a una, campeón. No tengo ocho brazos.",
  "Una foto nomás. Soy bot, no scanner de carnet.",
  "Pará pará… ¿me mandás un álbum entero? De a una.",
  "Easy. Una imagen a la vez y laburamos joya.",
  "No soy Mercado Libre: no acepto envíos múltiples 📦",
  "Un sticker a la vez, rey. No soy fábrica.",
  "¿Varias fotos? Nah. Mandame una y arrancamos.",
  "Soy sticker bot, no Google Fotos. De a una.",
  "Tranqui, mandame de a una que me mareás.",
];

export function pickMultiPhotoReply() {
  return REPLIES[Math.floor(Math.random() * REPLIES.length)];
}
