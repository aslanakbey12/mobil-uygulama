// Tartışma konuları. Her oda açıldığında seviyeye uygun rastgele bir konu seçilir.
// minLevel: bu konunun anlamlı tartışılabileceği en düşük CEFR seviyesi.
// reading: odaya girince herkesin önce okuyup anlayacağı kısa çerçeve metni.
// prompts: tartışmayı başlatan yönlendirici sorular ("ne diyeceğimi bilmiyorum"u çözer).

const LEVEL_ORDER = { A1: 0, A2: 1, B1: 2, B2: 3, C1: 4, C2: 5 };

export const TOPICS = [
  {
    id: "t_ai_danger", minLevel: "B1",
    text: "Will artificial intelligence become dangerous for humans in the future?",
    reading: "Artificial intelligence is improving very quickly. Some people worry that it could take many jobs, make important decisions without us, or even become impossible to control. Others believe AI is simply a powerful tool that will always depend on the rules and limits people give it.",
    prompts: ["Do you already use AI tools in your daily life?", "What do you think is the biggest risk?", "Can good rules keep AI safe, or not?"]
  },
  {
    id: "t_social_media", minLevel: "B1",
    text: "Does social media bring people closer together, or push them apart?",
    reading: "Social media lets us stay in touch with friends and family anywhere in the world. At the same time, many people feel lonelier, compare themselves to others, and argue more online than they would face to face. The same tool seems to both connect and divide us.",
    prompts: ["How many hours a day do you spend on it?", "Has it helped or hurt your real friendships?", "Would your life be better without it?"]
  },
  {
    id: "t_remote_work", minLevel: "B1",
    text: "Is working from home better than working in an office?",
    reading: "Since many companies started letting people work from home, opinions have been divided. Working from home saves travel time and offers freedom, but some people feel lonely or find it hard to focus. Others say an office helps teamwork and keeps work and home life separate.",
    prompts: ["Would you prefer home, office, or a mix?", "What is the hardest part of working from home?", "Does being together really help teamwork?"]
  },
  {
    id: "t_money_happy", minLevel: "B1",
    text: "Can money buy happiness?",
    reading: "Money can pay for food, safety, health, and free time, which clearly affect how we feel. But beyond a certain point, many studies suggest that more money brings little extra happiness. Relationships, health, and purpose may matter more than wealth.",
    prompts: ["How much money is 'enough' to be happy?", "What makes you happiest that costs nothing?", "Would you take a boring job for more money?"]
  },
  {
    id: "t_travel", minLevel: "A2",
    text: "What is the best way to travel: alone, with friends, or with family?",
    reading: "Some people love travelling alone because they are free to do anything they want. Others prefer friends or family, so they can share the experience and feel safe. Each way of travelling has good and bad sides.",
    prompts: ["How do you like to travel?", "What is good about travelling alone?", "What can go wrong in a group trip?"]
  },
  {
    id: "t_books_films", minLevel: "A2",
    text: "Which is better, reading a book or watching its film?",
    reading: "When a popular book becomes a film, people often argue about which one is better. A book lets you imagine everything in your own way and gives more detail. A film is faster, shows real images, and you can enjoy it with others.",
    prompts: ["Do you prefer the book or the film?", "Can a film ever be better than the book?", "Which book would make a great film?"]
  },
  {
    id: "t_city_village", minLevel: "A2",
    text: "Is it better to live in a big city or in a small town?",
    reading: "Big cities offer jobs, shops, and many things to do, but they can be crowded, noisy, and expensive. Small towns are usually quieter, cheaper, and calmer, but there may be fewer jobs and less to do. People want different things from where they live.",
    prompts: ["Where do you live now, and do you like it?", "What do you miss in your town or city?", "Where would you like to live in ten years?"]
  },
  {
    id: "t_school", minLevel: "B1",
    text: "Should schools teach practical life skills instead of only academic subjects?",
    reading: "Schools spend most of their time on subjects like maths, history, and science. Many people argue that students also need practical skills, such as managing money, cooking, or understanding contracts. Others say academic knowledge teaches students how to think, which matters most.",
    prompts: ["What useful skill did school never teach you?", "Should a class on money be required?", "What would you remove to make room for it?"]
  },
  {
    id: "t_climate", minLevel: "B2",
    text: "Who is most responsible for fighting climate change: governments, companies, or individuals?",
    reading: "Climate change is one of the biggest challenges of our time, yet people disagree about who should act. Governments can pass laws, large companies produce most emissions, and individuals make daily choices. Each group often points at the others.",
    prompts: ["Whose responsibility is it the most?", "What change have you personally made?", "Can individual choices really matter?"]
  },
  {
    id: "t_ubi", minLevel: "B2",
    text: "Should every citizen receive a basic income from the government?",
    reading: "A universal basic income means the government pays every citizen a fixed amount of money regularly, with no conditions. Supporters say it would reduce poverty and give people freedom. Critics worry it would be too expensive or discourage people from working.",
    prompts: ["Would you still work if you received it?", "Is it fairer than the current system?", "Where would the money come from?"]
  },
  {
    id: "t_fame", minLevel: "B2",
    text: "Is being famous more of a blessing or a curse?",
    reading: "Fame can bring money, influence, and exciting opportunities. But famous people also lose their privacy, face constant judgement, and can struggle with pressure and loneliness. The same spotlight that rewards them can also harm them.",
    prompts: ["Would you want to be famous? Why?", "What would be the hardest part?", "Is some fame better than total fame?"]
  },
  {
    id: "t_space", minLevel: "B2",
    text: "Should we spend money exploring space while there are problems on Earth?",
    reading: "Space exploration has led to new technology, knowledge, and inspiration, and some say it may one day be necessary for humanity's survival. Others argue that the money would be better spent solving urgent problems on Earth, such as poverty and disease.",
    prompts: ["Is space exploration worth the cost?", "What has space research given us already?", "Where would you spend the money instead?"]
  },
  {
    id: "t_ai_art", minLevel: "C1",
    text: "Can art created by artificial intelligence be considered real art?",
    reading: "AI systems can now produce paintings, music, and stories that many people find beautiful. Some argue this is genuine art, since the result moves us. Others insist that real art requires human emotion, intention, and experience, which a machine cannot have.",
    prompts: ["Does art need a human behind it?", "Would you pay for AI-made art?", "Who is the 'artist' when AI creates?"]
  },
  {
    id: "t_privacy", minLevel: "C1",
    text: "How much privacy should we be willing to give up for greater security?",
    reading: "Governments and companies can use cameras, data, and tracking to keep people safe and prevent crime. Yet the same tools can be used to watch ordinary citizens and limit their freedom. Societies must constantly balance privacy against security.",
    prompts: ["Where is the line for you?", "Do you trust companies with your data?", "Is some surveillance acceptable in public?"]
  },
  {
    id: "t_truth", minLevel: "C1",
    text: "In the age of the internet, is objective truth still possible?",
    reading: "The internet gives everyone access to endless information, but also to misinformation, opinions disguised as facts, and content designed to confirm what we already believe. Some argue that shared, objective truth is becoming harder to find, while others say good tools and critical thinking can still reveal it.",
    prompts: ["How do you decide what to believe online?", "Have you ever shared something false by accident?", "Can we agree on facts anymore?"]
  },
  {
    id: "t_food", minLevel: "A2",
    text: "What food from your country would you recommend to a foreign friend?",
    reading: "Every country has special dishes that say something about its culture. Food is one of the easiest and most enjoyable ways to share where you come from with someone new. Describing a favourite dish often brings back good memories.",
    prompts: ["What dish would you recommend, and why?", "Is it easy or hard to make?", "What food from another country do you love?"]
  }
];

export function pickTopic(level = "B1") {
  const lv = LEVEL_ORDER[level] ?? 2;
  const eligible = TOPICS.filter(t => (LEVEL_ORDER[t.minLevel] ?? 0) <= lv);
  const pool = eligible.length ? eligible : TOPICS;
  return pool[Math.floor(Math.random() * pool.length)];
}
