# Open Library vs Google Books descriptions (p2 prompts, Sonnet judge, K=12)

## 1. Usable descriptions

| Book | Open Library chars | Google Books chars | GB match |
|---|---|---|---|
| Normal People | 1109 | 1714 | Normal People |
| Beautiful World, Where Are You | 66 | 1034 | Beautiful World, Where Are You |
| Intermezzo | 974 | 2265 | Intermezzo |
| My Brilliant Friend | 0 | 1033 | My Brilliant Friend |
| Everything I Know About Love | 1206 | 1992 | Everything I Know About Love |
| The Plague | 1191 | 1418 | The Plague by Albert Camus |
| The Stranger | 0 | 2820 | The Stranger by Albert Camus |
| Candide | 548 | 2472 | Candide |
| Blindness | 0 | 1009 | Blindness |
| The Unbearable Lightness of Being | 0 | 2167 | The Unbearable Lightness of Being |
| The Sirens of Titan | 1999 | 1387 | The Sirens of Titan |
| The Wind-Up Bird Chronicle | 0 | 674 | The Wind-Up Bird Chronicle |
| Kafka on the Shore | 0 | 795 | Kafka on the Shore |
| Norwegian Wood | 2027 | 0 | (none) |
| Convenience Store Woman | 937 | 1780 | Convenience Store Woman |
| My Year of Rest and Relaxation | 576 | 0 | (none) |
| Set My Heart on Fire | 0 | 1008 | Set My Heart on Fire |
| The Course | 273 | 2491 | The Course |
| Inverting the Pyramid | 1080 | 1343 | Inverting the Pyramid |

Usable (>= 200 chars): **Open Library 11/19, Google Books 17/19.** Mean length where present: OL 999, GB 1612.

## 2. Enrichment: possible invented names or details

Capitalised words in the Enrichment that appear in neither the title, author, description nor subjects (candidates only; read them).

**Open Library**
- Normal People: Irish, Rooney's
- Beautiful World, Where Are You: The
- My Brilliant Friend: The, Ferrante's, Neapolitan, Naples
- The Plague: North, African
- The Stranger: Algeria
- Candide: Through
- Blindness: An
- The Unbearable Lightness of Being: Prague
- The Wind-Up Bird Chronicle: Toru, Okada, Tokyo
- Kafka on the Shore: Two
- Inverting the Pyramid: Barcelona's

**Google Books**
- Normal People: Irish
- Beautiful World, Where Are You: Four, Alice's
- My Brilliant Friend: Set
- Everything I Know About Love: London
- The Plague: Algerian, Written
- The Stranger: Written
- The Wind-Up Bird Chronicle: Japan's, Murakami's
- Kafka on the Shore: Two
- Norwegian Wood: Tokyo, Murakami's
- My Year of Rest and Relaxation: The
- Set My Heart on Fire: Tokyo's, Told, Western
- The Course: Texas

Summaries for the books whose source changed most:

### My Brilliant Friend
- OL (0 chars, recognised=true): The graphic novel adaptation of Elena Ferrante's first novel in the Neapolitan series, following the intense friendship between two girls growing up in post-war Naples. The story traces their competing ambitions, intellectual rivalry, and the social constraints of their working-class neighborhood as they navigate adolescence and education.
- GB (1033 chars, recognised=true): Set in 1950s Naples, this novel follows the lifelong friendship between Lila and Elena from their first meeting as ten-year-olds through their school years and adolescence. Through their intertwined lives, Ferrante depicts a poor but vibrant neighborhood undergoing social transformation, examining how the girls' complex bond—marked by competition, admiration, and conflict—shapes and is shaped by their changing circumstances.

### Set My Heart on Fire
- OL (0 chars, recognised=false): (unrecognised, no Enrichment)
- GB (1008 chars, recognised=true): Set in 1970s Tokyo's underground bar and club scene, this semi-autobiographical novel follows a young woman named Izumi through her turbulent twenties as she navigates short, complicated relationships, desire, drugs, and music. Told through a series of frank vignettes, the narrative charts her encounters with unreliable men, powerful substances, and the transformative experience of meeting Jun, while a pulsing soundtrack of Western rock and Japanese psychedelic bands underscores her journey toward regret and acceptance.

### Beautiful World, Where Are You
- OL (66 chars, recognised=true): The novel follows four young people in contemporary Dublin—two successful women and two men—as their friendships and romantic entanglements shift and deepen over the course of a year. Rooney examines intimacy, desire, and connection through email exchanges, conversations, and interior observation, tracing how relationships evolve when people struggle to articulate what they want from one another.
- GB (1034 chars, recognised=true): Four young people in Dublin—Alice, a novelist; Felix, a warehouse worker; Eileen, Alice's best friend; and Simon, a childhood acquaintance—navigate romantic and platonic entanglements while grappling with contemporary anxieties and questions about meaning. The novel unfolds through their meetings, a trip to Rome, and intimate correspondence, exploring how desire, friendship, and self-deception shape their search for connection and belief in a worthwhile world.

### Norwegian Wood
- OL (2027 chars, recognised=true): A melancholic retrospective novel following Toru Watanabe as he recalls his late twenties in 1960s Tokyo, navigating love, loss, and grief in the aftermath of his best friend's suicide. The narrative explores his entanglement with two women—the fragile, haunted Naoko and the vibrant Midori—as he struggles to reconcile desire, emotional connection, and the reality of human suffering.
- GB (0 chars, recognised=true): A melancholic coming-of-age novel set in 1960s Tokyo following a young college student navigating love, loss, and isolation. The narrative explores romantic relationships and psychological disconnection through Murakami's characteristic blend of everyday realism and emotional introspection.

## 3. Explanations

| | Open Library | Google Books |
|---|---|---|
| Connections returned | 50 | 55 |
| of which weak | 14 | 19 |
| weak quoting both Books' Notes | 4 | 4 |
| quotes | 35 | 30 |
| invalid quotes | 0 | 0 |
| quoted Notes without the book named | 0 | 0 |
| recommending phrases | 0 | 0 |
| Books with no Connections | 4 | 3 |

**Stored Connections (floor moderate + weak-with-both-Notes, cap 5):** OL 38, GB 39; 31 shared, 7 only with OL, 8 only with GB.

Only with Open Library descriptions:
- The Plague ↔ The Wind-Up Bird Chronicle (moderate)
- Everything I Know About Love ↔ Intermezzo (weak)
- Convenience Store Woman ↔ Intermezzo (weak)
- The Unbearable Lightness of Being ↔ The Wind-Up Bird Chronicle (moderate)
- Candide ↔ The Unbearable Lightness of Being (moderate)
- Norwegian Wood ↔ The Unbearable Lightness of Being (moderate)
- Norwegian Wood ↔ My Year of Rest and Relaxation (moderate)

Only with Google Books descriptions:
- Intermezzo ↔ The Wind-Up Bird Chronicle (weak): Intermezzo's grief and its themes of isolation and connection echo the loss, absence and disconnection in The Wind-Up Bird Chronicle. Your notes also share a taste for interior drift: you mentioned Peter's stream of consciousness in Intermezzo and how Okada "drifts from story to story, place to place" in The Wind-Up Bird Chronicle.
- Blindness ↔ Candide (moderate): Both put people through exaggerated catastrophe and social breakdown to test how they endure. Blindness follows survival and resilience in a collapsed order, and Candide's absurd misfortunes yield a similar picture of resilience amid chaos.
- Convenience Store Woman ↔ Normal People (moderate): Normal People attends to belonging, outsiderdom and the gap between inner life and social performance, which echoes Convenience Store Woman's protagonist performing normality to fit in.
- Norwegian Wood ↔ The Stranger (moderate): Both present narrators marked by emotional numbness and alienation, with a death shaping the story, though The Stranger turns this into absurdist indifference toward society while Norwegian Wood treats it as melancholic mourning.
- Beautiful World, Where Are You ↔ Norwegian Wood (weak): Both books follow romantic attachments and emotional vulnerability, and your notes single out relationships and writing in each: Norwegian Wood's "growth through love" and, on Beautiful World, Where Are You, "alice and felix's relationship 10/10, emails were a highlight".
- Norwegian Wood ↔ Set My Heart on Fire (strong): Both are set in Tokyo, with Norwegian Wood in the 1960s and Set My Heart on Fire in the 1970s, and both follow young people through love, loss and the pull of counterculture. Your note on Norwegian Wood, "irony pervades the novel, especially the student revolution (performative?)", points at the same youth-movement era that Suzuki's underground scene grows out of.
- My Year of Rest and Relaxation ↔ Set My Heart on Fire (moderate): Both centre on young women whose use of drugs and excess becomes a way of coping with dissatisfaction, with chemical escape as a recurring thread. Your note on My Year of Rest and Relaxation, "the protagonist is somehow a terrible person but understandable", describes a flawed but comprehensible narrator, which fits Suzuki's frank, unreliable-feeling account of her own youth.
- Everything I Know About Love ↔ Set My Heart on Fire (moderate): Both are candid accounts of a woman's twenties, covering messy relationships, desire and self-discovery through experience. Alderton's London memoir takes a witty, friendship-centred approach, while Suzuki's Tokyo vignettes are more transgressive.

### Isolated Books (should have none: The Course, Inverting the Pyramid)

- OL: The Course 1 edges, Inverting the Pyramid 1, Set My Heart on Fire 0
- GB: The Course 1 edges, Inverting the Pyramid 1, Set My Heart on Fire 3

## 4. Clusters (resolution 1.0)

**Open Library** (1 renames, 1 dissolutions over the replay)
- **Tender, Tangled Twenties**: Beautiful World, Where Are You; My Brilliant Friend; Everything I Know About Love; Intermezzo; Normal People. Young adults fumbling toward intimacy, caught between desire, friendship, and self-protection. These books trace how love and close bonds shape, wound, and eventually help people grow into themselves.
- **Living Through the Absurd**: Blindness; Candide; The Plague; The Sirens of Titan; The Unbearable Lightness of Being. Philosophical novels that confront suffering, catastrophe, and political upheaval, questioning easy certainties about meaning, reason, and choice. Their characters find what dignity, solidarity, or love they can in a world that offers no guarantees.
- **Strangers in Ordinary Lives**: Convenience Store Woman; Kafka on the Shore; Norwegian Wood; My Year of Rest and Relaxation; The Stranger; The Wind-Up Bird Chronicle. Detached, estranged protagonists drift through mundane routines and social expectations, withdrawing or being pushed into strange inner and outer worlds. Each book probes alienation and the thin line between numb normalcy and the surreal.

**Google Books** (5 renames, 2 dissolutions over the replay)
- **Meaning Amid Catastrophe**: Blindness; Candide; The Plague; The Sirens of Titan; The Unbearable Lightness of Being. Novels that put ordinary people through plague, blindness, war, or political upheaval to ask how to live when suffering is arbitrary and grand ideologies fail. Each answers through satire, allegory, or philosophical reflection, favoring solidarity, responsibility, and small acts of choice over abstract certainty.
- **Outsiders Refusing the Script**: Convenience Store Woman; My Year of Rest and Relaxation; The Stranger. Detached protagonists who can't or won't perform the emotions and roles society expects of them, and who are judged, pitied, or pushed to the margins for it. Each turns indifference, withdrawal, or oddness into a strange form of authenticity.
- **Intimacy and Becoming**: Beautiful World, Where Are You; My Brilliant Friend; Everything I Know About Love; Intermezzo; Normal People. Stories of people finding who they are through the friends and lovers who shape them, often across lines of class and self-doubt. Emotional vulnerability and the struggle to truly connect run through each one.
- **Lonely Drifters of Tokyo**: Kafka on the Shore; Norwegian Wood; Set My Heart on Fire; The Wind-Up Bird Chronicle. Restless young and midlife Japanese protagonists drift through loss, desire, and disconnection, searching for selfhood. Memory, grief, and the surreal blur the line between inner life and the outside world.

## 5. Cost

| | Open Library | Google Books |
|---|---|---|
| Enrichment (19 Books, Haiku) | $0.0236 | $0.0283 |
| Judge (Sonnet) | $0.1810 | $0.1980 |
| Judge input tokens | 55826 | 61656 |
| Per finished Book (Enrichment + judge) | $0.0108 | $0.0119 |
