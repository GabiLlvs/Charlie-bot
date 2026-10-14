const REPLIES = [
  "Flaquito de a uno que no soy pulpo 🐙",
  "De a una, campeón. No tengo ocho brazos.",
  "Una foto nomás, no soy impresora",
  "Pará pará… ¿me mandás un álbum entero? De a una.",
  "Baja un cambio. Una imagen a la vez y laburamos joya.",
  "PARA UN POQUITOOOO, DE A UNA!!!",
  "Un sticker a la vez, rey. No soy fábrica.",
  "¿Varias fotos? Nah. Mandame una y arrancamos.",
  "Paso a paso, campeón.",
  "Tranqui, mandame de a una que me mareás.",
];

export function pickMultiPhotoReply() {
  return REPLIES[Math.floor(Math.random() * REPLIES.length)];
}
