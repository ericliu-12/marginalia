// PROTOTYPE data: the reader's real Finished Books and Notes (from their Goodreads reviews).
// `theme` is the reader's expected grouping, used only as a rough sanity check. Provisional: the
// reader named three themes but not every assignment, so these placements are an assumption.

export const BOOKS = [
  { slug: 'normal-people', title: 'Normal People', author: 'Sally Rooney', theme: 'love' },
  { slug: 'beautiful-world', title: 'Beautiful World, Where Are You', author: 'Sally Rooney', theme: 'love',
    notes: ["alice and felix's relationship 10/10, emails were a highlight"] },
  { slug: 'intermezzo', title: 'Intermezzo', author: 'Sally Rooney', theme: 'love',
    notes: ["a meditation on grief, pursue living through the dark times. gets better every reread, immersed in peter's stream of consciousness"] },
  { slug: 'brilliant-friend', title: 'My Brilliant Friend', author: 'Elena Ferrante', theme: 'love' },
  { slug: 'everything-love', title: 'Everything I Know About Love', author: 'Dolly Alderton', theme: 'love',
    notes: ["love isn't just romance, cherish friendships"] },
  { slug: 'plague', title: 'The Plague', author: 'Albert Camus', theme: 'absurd' },
  { slug: 'stranger', title: 'The Stranger', author: 'Albert Camus', theme: 'absurd' },
  { slug: 'candide', title: 'Candide', author: 'Voltaire', theme: 'absurd' },
  { slug: 'blindness', title: 'Blindness', author: 'José Saramago', theme: 'absurd',
    notes: ['interesting use of visibility as a deterrent. the dog who wipes away the tears'] },
  { slug: 'unbearable', title: 'The Unbearable Lightness of Being', author: 'Milan Kundera', theme: 'love',
    notes: ['loved the writing and really liked the thoughts on lightness vs weight, especially when it comes to coincidence'] },
  { slug: 'sirens', title: 'The Sirens of Titan', author: 'Kurt Vonnegut', theme: 'absurd',
    notes: ['things are outside of your control, make the most of it'] },
  { slug: 'wind-up-bird', title: 'The Wind-Up Bird Chronicle', author: 'Haruki Murakami', theme: 'dream',
    notes: ['questions whether or not we are truly free. Okada drifts from story to story, place to place. the letters were the best part'] },
  { slug: 'kafka-shore', title: 'Kafka on the Shore', author: 'Haruki Murakami', theme: 'dream',
    notes: ["the boy named crow represents the id to kafka's ego. murakami weaves smoothly between reality and dream, using rivers and transitions as metaphor"] },
  { slug: 'norwegian-wood', title: 'Norwegian Wood', author: 'Haruki Murakami', theme: 'love',
    notes: ['growth through love. irony pervades the novel, especially the student revolution (performative?). Reiko was the most well written, liked her thoughts on music for yourself'] },
  { slug: 'convenience-store', title: 'Convenience Store Woman', author: 'Sayaka Murata', theme: 'dream',
    notes: ["pretty funny but didn't fully get the point"] },
  { slug: 'rest-relaxation', title: 'My Year of Rest and Relaxation', author: 'Ottessa Moshfegh', theme: 'dream',
    notes: ['the protagonist is somehow a terrible person but understandable. snippets felt like a dream'] },
  { slug: 'set-my-heart', title: 'Set My Heart on Fire', author: 'Izumi Suzuki', theme: 'dream' },
  { slug: 'the-course', title: 'The Course', author: 'Ed Miller', theme: 'isolated' },
  { slug: 'inverting-pyramid', title: 'Inverting the Pyramid', author: 'Jonathan Wilson', theme: 'isolated' },
];

// Fixed, seeded-looking finish order so themes interleave (the real pipeline judges each Book
// against the Books finished before it). Hand-written so runs are reproducible.
export const ORDER = [
  'normal-people', 'plague', 'wind-up-bird', 'everything-love', 'stranger', 'the-course',
  'beautiful-world', 'kafka-shore', 'blindness', 'intermezzo', 'candide', 'convenience-store',
  'brilliant-friend', 'unbearable', 'rest-relaxation', 'sirens', 'norwegian-wood',
  'inverting-pyramid', 'set-my-heart',
];
