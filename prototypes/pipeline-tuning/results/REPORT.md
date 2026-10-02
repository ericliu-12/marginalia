# Pipeline tuning results (PROTOTYPE, ticket #13)

Sample: 19 Finished Books, 11 with Notes. Judge run in finish order (each Book vs the Books finished before it). Total spend **$0.541** of the $15 cap. OpenAI `text-embedding-3-small` was **not tested** (no key); the bake-off is voyage-4 vs voyage-4-lite.

## 1. Measured cost per finished Book

| Step | Tier / model | Cost per Book |
|---|---|---|
| Enrichment | Haiku 4.5 | $0.0011 |
| Enrichment | Sonnet 5.5 | $0.0037 |
| Connection judge, average over the run | Sonnet 5.5 | $0.0103 |
| Connection judge, steady state (12 candidates) | Sonnet 5.5 | $0.0136 |
| Connection judge, steady state (12 candidates) | Haiku 4.5 | $0.0047 |
| Embeddings (Enrichment + Notes) | voyage-4 / lite | ~$0.0000 (0.00032 total) |
| Cluster naming/description | Sonnet 5.5 | $0.0021 per call, 4 calls over the replay |

**Running cost per finished Book (steady state): Haiku Enrichment + Sonnet judge ≈ $0.0147; Haiku + Haiku ≈ $0.0059; Sonnet + Sonnet ≈ $0.0173.** Notes in this sample are short, so the judge input is small; real Notes at the 600-token-per-candidate budget would raise the judge cost (worst case roughly 2-3x). A Refresh costs one judge call.

## 2. Low-confidence rule (no usable Open Library description, < 200 chars)

| Book | OL description chars | Flagged |
|---|---|---|
| Normal People | 1109 |  |
| Beautiful World, Where Are You | 66 | LOW |
| Intermezzo | 974 |  |
| My Brilliant Friend | 0 | LOW |
| Everything I Know About Love | 1206 |  |
| The Plague | 1191 |  |
| The Stranger | 0 | LOW |
| Candide | 548 |  |
| Blindness | 0 | LOW |
| The Unbearable Lightness of Being | 0 | LOW |
| The Sirens of Titan | 1999 |  |
| The Wind-Up Bird Chronicle | 0 | LOW |
| Kafka on the Shore | 0 | LOW |
| Norwegian Wood | 2027 |  |
| Convenience Store Woman | 937 |  |
| My Year of Rest and Relaxation | 576 |  |
| Set My Heart on Fire | 0 | LOW |
| The Course | 273 |  |
| Inverting the Pyramid | 1080 |  |

**8/19 flagged.** Six of them are famous books Claude knows well with a 0-character OL description, so changing the threshold would not fix this; the rule is checking the wrong thing. Conservative vs normal Enrichment for each flagged Book:

### Beautiful World, Where Are You
- Conservative: Sally Rooney's third novel follows four young people in Dublin whose relationships shift and reconfigure over the course of the book. The narrative moves between their emails, conversations, and inner lives, examining how intimacy and connection form between friends and romantic partners. _Themes:_ friendship and loyalty; romantic relationships; class and privilege; desire and attachment; communication and misunderstanding; contemporary Irish life
- Normal: A novel following three Dublin-based friends—Eileen, Alice, and Danielle—as their relationships shift and deepen over the course of a year, with new romantic entanglements complicating their long-standing friendship. The narrative unfolds through conversations, emails, and interior observations as the characters navigate work, love, and what it means to maintain intimacy across different life circumstances. Rooney's prose is sparse and colloquial, focusing on the emotional undercurrents of everyday interaction rather than dramatic events. _Themes:_ friendship and loyalty; romantic love and desire; intellectual ambition versus personal fulfillment; connection in the digital age; class and social anxiety; the gap between internal life and external presentation

### My Brilliant Friend
- Conservative: This is a graphic novel adaptation of Elena Ferrante's novel about two girls growing up in postwar Naples. The metadata provided identifies it as a comics adaptation of a literary work, but I cannot confidently describe the specific plot or narrative approach of this graphic version without direct knowledge of it. _Themes:_ female friendship; coming of age; class and poverty; Naples and Italian life; literary adaptation
- Normal: This is the graphic novel adaptation of Elena Ferrante's first novel in the Neapolitan series, following the intense friendship between Elena and Lila from childhood in 1950s Naples through their teenage years. The story captures their fierce rivalry and deep bond as they navigate education, family, violence, and ambition in a poor neighborhood, with the graphic format rendering the narrative's emotional intensity through visual storytelling. _Themes:_ female friendship and rivalry; coming of age in poverty; Naples and Italian identity; education as escape; violence and power dynamics; memory and nostalgia

### The Stranger
- Conservative: Camus's existential novel follows Meursault, an emotionally detached man in Algeria who commits a murder and faces trial. The narrative is sparse and matter-of-fact, presenting events without psychological explanation or moral judgment, forcing readers to confront questions about meaning and indifference in an absurd world. _Themes:_ absurdism; alienation and detachment; meaning and meaninglessness; death and mortality; justice and judgment
- Normal: A man named Meursault commits a meaningless murder on an Algerian beach and faces trial, during which his emotional detachment and refusal to conform to social expectations become more damning than the crime itself. The novel presents an absurdist exploration of existence, told in a sparse, direct style that mirrors the protagonist's emotional numbness. _Themes:_ absurdism and meaninglessness; emotional detachment and alienation; the individual versus society; indifference to conventional morality; the contingency of human existence; the trial as judgment of character rather than crime

### Blindness
- Conservative: A city is struck by an epidemic of blindness that spreads rapidly through the population. Saramago follows a group of blind people—including a doctor, his wife, and others—as they navigate a collapsing society, confinement in an asylum, and the moral chaos that ensues when sight is lost. The novel is written in Saramago's distinctive style with minimal punctuation and long, flowing passages that mirror the disorientation of blindness. _Themes:_ blindness as metaphor for moral blindness; collapse of social order; human vulnerability and survival; isolation and community; sight and perception
- Normal: An unexplained epidemic of blindness strikes a city, and the narrative follows a group of afflicted people confined in a mental asylum as society collapses around them. The book is told in Saramago's distinctive style of long, unpunctuated passages that create an immersive, disorienting experience mirroring the characters' loss of sight. _Themes:_ Loss of vision as metaphor for moral blindness; Survival and degradation under extreme conditions; Breakdown of social order and civilization; Interdependence and human solidarity; The unreliability of perception and knowledge

### The Unbearable Lightness of Being
- Conservative: Kundera's philosophical novel explores the tension between eternal return and the fleeting nature of human existence, following multiple characters whose lives intersect in 1960s Prague against the backdrop of the Soviet invasion of Czechoslovakia. The book weaves together narrative, philosophical meditation, and metaphorical exploration in a fragmented, essayistic style rather than conventional plot. _Themes:_ eternal return and contingency; the weight and weightlessness of existence; love and commitment; body and soul; historical inevitability; the paradox of freedom
- Normal: Kundera explores the philosophical tension between eternal recurrence and the transience of human life through interconnected narratives of four characters—Tomas, Tereza, Sabina, and Franz—whose relationships unfold against the backdrop of the 1968 Soviet invasion of Czechoslovakia. The novel weaves together philosophical meditation with intimate personal drama, examining how individuals navigate meaning, love, and commitment in a world without inherent purpose. _Themes:_ eternal recurrence and its existential weight; the paradox of lightness and heaviness in existence; kitsch and the human need for meaning; erotic desire versus emotional commitment; political power and personal freedom; the impossibility of certain knowledge about others

### The Wind-Up Bird Chronicle
- Conservative: Haruki Murakami's novel follows Toru Okada, a man who withdraws from ordinary life after losing his job, as he navigates a series of strange occurrences—including the disappearance of his wife and encounters with mysterious characters. The narrative is deliberately disorienting, moving between realistic domestic scenes and surreal, dreamlike episodes without clear resolution or explanation. _Themes:_ isolation and disconnection from society; the surreal and inexplicable; marriage and domestic life; loss of meaning and purpose; mysterious forces beyond explanation
- Normal: A Tokyo man named Toru Okada searches for his missing wife while encountering a series of strange and surreal events—including a talking cat, a mysterious woman in a well, and a violent historical tangent about a Japanese soldier in Manchuria. The narrative drifts between mundane domestic life and dreamlike episodes, creating an unsettling atmosphere where the ordinary and supernatural are blended without clear explanation. _Themes:_ isolation and disconnection; surrealism and the uncanny; memory and trauma; domestic unhappiness; the search for meaning in absurdity; parallel realities and alternate narratives

### Kafka on the Shore
- Conservative: Kafka on the Shore follows two parallel narratives: a teenage boy named Kafka who runs away from home, and an elderly man named Nakata who travels across Japan following mysterious instructions. The novel weaves together magical realism, memory, and longing as the two stories intersect in unexpected ways. Murakami's prose is contemplative and strange, blending the mundane with the surreal. _Themes:_ displacement and running away; parallel lives and interconnection; magical realism; memory and the past; loneliness and isolation; the search for meaning
- Normal: Kafka on the Shore follows two interconnected narratives: a fifteen-year-old boy named Kafka who runs away from home to escape a mysterious family curse, and an aging man named Nakata who travels across Japan in search of a mystical entrance. The novel weaves together magical realism with mundane details of modern Japan, blending surreal events like fish falling from the sky with quiet moments of introspection and loss. _Themes:_ Escape and isolation; Magical realism; Memory and the past; Loneliness and connection; Destiny and free will; Coming of age

### Set My Heart on Fire
- Conservative: I don't have reliable information about this specific book's content and plot. Izumi Suzuki is a Japanese author, but without verified details about this particular title, I cannot confidently describe its narrative or reading experience. _Themes:_ Japanese fiction; contemporary literature
- Normal: I don't have reliable information about this specific book by Izumi Suzuki to provide an accurate summary and themes. While Izumi Suzuki was a notable Japanese science fiction writer, I cannot confidently confirm the details of a book with this exact title without access to the text or verified sources. _Themes:_ Unable to verify

## 3. Embeddings bake-off (voyage-4 vs voyage-4-lite)

Theme precision@3 = share of a Book's top-3 candidates in the same expected theme (rough, provisional themes; cross-theme links can be legitimate). Overlap = share of top-k candidates both models agree on.

- voyage-4: 0.58  |  voyage-4-lite: 0.56
- Overlap@3 0.79, overlap@5 0.80

| Book | voyage-4 top 3 | voyage-4-lite top 3 |
|---|---|---|
| Normal People | Beautiful World, Where Are You; Intermezzo; Everything I Know About Love | Beautiful World, Where Are You; Intermezzo; Everything I Know About Love |
| The Plague | Blindness; The Stranger; The Unbearable Lightness of Being | Blindness; The Stranger; The Unbearable Lightness of Being |
| The Wind-Up Bird Chronicle | Kafka on the Shore; Norwegian Wood; My Year of Rest and Relaxation | Kafka on the Shore; Norwegian Wood; My Year of Rest and Relaxation |
| Everything I Know About Love | Beautiful World, Where Are You; The Sirens of Titan; Normal People | Beautiful World, Where Are You; The Sirens of Titan; Normal People |
| The Stranger | The Plague; The Wind-Up Bird Chronicle; The Unbearable Lightness of Being | The Plague; The Unbearable Lightness of Being; The Wind-Up Bird Chronicle |
| The Course | Inverting the Pyramid; The Sirens of Titan; The Stranger | Inverting the Pyramid; The Sirens of Titan; Intermezzo |
| Beautiful World, Where Are You | Normal People; Everything I Know About Love; Intermezzo | Normal People; Everything I Know About Love; Intermezzo |
| Kafka on the Shore | The Wind-Up Bird Chronicle; Norwegian Wood; The Unbearable Lightness of Being | The Wind-Up Bird Chronicle; Norwegian Wood; The Unbearable Lightness of Being |
| Blindness | The Plague; The Unbearable Lightness of Being; The Wind-Up Bird Chronicle | The Plague; The Unbearable Lightness of Being; The Wind-Up Bird Chronicle |
| Intermezzo | Beautiful World, Where Are You; Norwegian Wood; Normal People | Beautiful World, Where Are You; Norwegian Wood; My Year of Rest and Relaxation |
| Candide | The Sirens of Titan; The Stranger; Blindness | The Stranger; The Sirens of Titan; The Unbearable Lightness of Being |
| Convenience Store Woman | My Year of Rest and Relaxation; Blindness; The Unbearable Lightness of Being | Blindness; My Year of Rest and Relaxation; The Wind-Up Bird Chronicle |
| My Brilliant Friend | Beautiful World, Where Are You; Normal People; Everything I Know About Love | Beautiful World, Where Are You; Everything I Know About Love; Normal People |
| The Unbearable Lightness of Being | The Sirens of Titan; Kafka on the Shore; The Wind-Up Bird Chronicle | Kafka on the Shore; Norwegian Wood; The Plague |
| My Year of Rest and Relaxation | The Wind-Up Bird Chronicle; Intermezzo; The Unbearable Lightness of Being | The Wind-Up Bird Chronicle; Intermezzo; Beautiful World, Where Are You |
| The Sirens of Titan | The Unbearable Lightness of Being; The Wind-Up Bird Chronicle; Candide | Everything I Know About Love; The Unbearable Lightness of Being; The Wind-Up Bird Chronicle |
| Norwegian Wood | The Wind-Up Bird Chronicle; Kafka on the Shore; Intermezzo | The Wind-Up Bird Chronicle; Kafka on the Shore; The Unbearable Lightness of Being |
| Inverting the Pyramid | The Course; The Unbearable Lightness of Being; Beautiful World, Where Are You | The Course; The Unbearable Lightness of Being; Beautiful World, Where Are You |
| Set My Heart on Fire | (none: no embedding) | (none) |

## 4. Judge: Sonnet 5.5 vs Haiku 4.5 (same candidates, same prompt)

| | Sonnet | Haiku |
|---|---|---|
| Connections returned | 52 | 42 |
| Marked weak | 15 | 0 |
| Quotes in explanations | 21 | 22 |
| Quotes NOT verbatim in a cited Note | 0 | 5 |

Quotes flagged invalid are shown as **[INVALID: …]**. Read both sides and judge whether Haiku's explanations are good enough.

### Normal People
_No Connections from either model._

### The Plague
_No Connections from either model._

### The Wind-Up Bird Chronicle (has Notes)
**Sonnet**
- thematic/moderate → The Plague: Both novels present people facing an inexplicable disruption of ordinary life and searching for meaning within it. The Plague answers with solidarity and defiance, while Toru Okada's response in The Wind-Up Bird Chronicle is withdrawal and isolation.

**Haiku**
- thematic/strong → The Plague: Both novels explore meaninglessness and the human response to circumstances beyond individual control. Like Okada's drifting through inexplicable events, Camus's characters confront absurdity and loss of meaning, and your note that Okada's story raises the question of whether "we are truly free" resonates with The Plague's investigation of how individuals respond when external forces remove ordinary agency and purpose.

### Everything I Know About Love (has Notes)
**Sonnet**
- contrast/moderate → Normal People: Both books follow young people through the uncertainty of early adult relationships in Dublin and London. Normal People keeps its focus on one romantic bond and the shame and self-doubt that block honesty, while Alderton shows friendship as the relationship that lasts.

**Haiku**
- thematic/moderate → Normal People: Both memoirs and novels explore the complexity of intimate human connection beyond surface-level romance. Like Alderton's assertion that "love isn't just romance, cherish friendships," Normal People examines the depth and persistence of emotional bonds that transcend romantic categorization, showing how Connell and Marianne's connection endures across years despite their attempts to separate.

### The Stranger (no Notes)
**Sonnet**
- context/strong → The Plague: Both are Camus novels set in Algeria, and both use a restrained, matter-of-fact narrative to explore absurdity, mortality and meaninglessness. The Stranger shows detachment from the absurd, while The Plague shows people answering it with solidarity and defiance.
- thematic/moderate → The Wind-Up Bird Chronicle: Both follow a man who is disconnected from ordinary life and from the meaning others find in it, told without tidy explanation or resolution. Your note that the book "questions whether or not we are truly free" touches a question The Stranger also raises through Meursault's detachment and trial.

**Haiku**
- context/strong → The Plague: Both novels are by Camus and set in Algeria, sharing his distinctive spare, documentary-like narrative style and exploring how individuals confront meaninglessness and mortality in an absurd world.
- thematic/moderate → The Wind-Up Bird Chronicle: Both protagonists experience profound alienation and detachment from ordinary life, drifting through events without clear meaning or resolution, forcing readers to sit with existential uncertainty rather than seek answers.

### The Course (no Notes)
**Sonnet**
- (none)

**Haiku**
- thematic/moderate → Everything I Know About Love: Both books value unconventional thinking—The Course advocates differentiation through unique poker approaches, while Everything I Know About Love explores "what adulthood actually feels like rather than what it's supposed to look like." Each asks readers to question standard assumptions about their respective domains. **[INVALID: what adulthood actually feels like rather than what it's supposed to look like.]**

### Beautiful World, Where Are You (has Notes)
**Sonnet**
- context/strong → Normal People: Both are Sally Rooney novels set in Dublin, and both follow young people whose intimacy is complicated by class, miscommunication and the gap between what they say and what they feel. If you liked the Alice and Felix thread in Beautiful World, Where Are You, Connell and Marianne offer a similar close look at a relationship.
- thematic/moderate → Everything I Know About Love: Both books treat friendship as central to adult life alongside romance. Your note "love isn't just romance, cherish friendships" fits the friendship and loyalty at the heart of Rooney's novel, though Alderton's memoir is humorous and Rooney's novel is more restrained.
- context/weak → The Wind-Up Bird Chronicle: The only clear link is form: you singled out the emails in Rooney's novel as a highlight, and you said of Murakami's book "the letters were the best part". Their subject matter is otherwise very different.

**Haiku**
- context/strong → Normal People: Both are Sally Rooney novels set in Dublin that examine intimate relationships through spare, dialogue-driven prose. Like your experience with Alice and Felix's emails in Beautiful World, Where Are You, Normal People similarly traces a persistent connection between two people across time, exploring how they communicate and misunderstand each other.
- thematic/moderate → Everything I Know About Love: Both books examine friendship and romantic connection as central to understanding intimacy and adulthood. Your note that "love isn't just romance, cherish friendships" resonates with how Beautiful World, Where Are You treats the four characters' friendships as equally significant to their romantic entanglements.

### Kafka on the Shore (has Notes)
**Sonnet**
- context/strong → The Wind-Up Bird Chronicle: Same author, and both novels slide between realistic domestic life and dreamlike episodes without tidy resolution. Your note on Kafka on the Shore says Murakami "weaves smoothly between reality and dream", and your note on The Wind-Up Bird Chronicle says Okada "drifts from story to story, place to place", which echoes the wandering of Kafka and Nakata.
- thematic/moderate → The Stranger: Both books deal with alienation and detachment, and with the search for meaning in a world that offers no clear answer. Kafka's loneliness and Meursault's emotional distance approach this from very different tones, one dreamlike and one flat and matter-of-fact.

**Haiku**
- context/strong → The Wind-Up Bird Chronicle: Both are Murakami novels that blend reality and dream in similar ways. You noted how Kafka on the Shore uses "rivers and transitions as metaphor" between these realms, and The Wind-Up Bird Chronicle employs the same technique of moving "between realistic domestic scenes and surreal, dreamlike episodes." **[INVALID: between realistic domestic scenes and surreal, dreamlike episodes.]**
- thematic/moderate → The Plague: Both novels explore isolation and disconnection from ordinary life as a path toward confronting deeper meaning. Kafka on the Shore deals with "displacement and running away" and "the search for meaning," while The Plague presents how people find meaning through solidarity when normal life breaks down. **[INVALID: displacement and running away | the search for meaning,]**

### Blindness (has Notes)
**Sonnet**
- thematic/strong → The Plague: Both novels use an epidemic as a literal catastrophe and a metaphor, following ordinary people as social order breaks down and solidarity becomes the main form of resistance. Camus's restrained, documentary tone contrasts with Saramago's flowing, disorienting prose, but the central concern is the same.
- context/weak → The Stranger: This is a looser link through the shared author of The Plague, with Camus's absurdist concerns about meaning and indifference echoing the moral questions in Blindness. The Stranger has no epidemic or collective crisis, so the connection is mostly one of philosophical mood.
- thematic/weak → The Wind-Up Bird Chronicle: Both books feature people cut off from ordinary life and drifting through disorienting circumstances that are never fully explained. Your note on The Wind-Up Bird Chronicle asks whether we are truly free, which loosely echoes the confinement and lost freedom in Blindness.

**Haiku**
- thematic/strong → The Plague: Both novels use an epidemic—blindness and plague—as the central catastrophe that strips away social order and forces characters to confront fundamental questions about human meaning and survival. Each explores how people respond to sudden, inexplicable crisis and the moral chaos that follows.
- thematic/moderate → The Stranger: Both Saramago and Camus explore moral indifference and the impossibility of rational meaning-making in the face of absurd circumstances. Blindness, like Meursault's detachment, presents a protagonist whose disconnect from normal moral perception becomes the lens through which the reader confronts the arbitrary nature of meaning itself.

### Intermezzo (has Notes)
**Sonnet**
- context/strong → Beautiful World, Where Are You: Both are Sally Rooney novels about Dublin relationships and the inner lives of people in their twenties and thirties. You singled out Alice and Felix's relationship and the emails in this one, while Intermezzo moves closer to grief and the two brothers' entanglements.
- context/strong → Normal People: Normal People is also Rooney's psychologically interior Dublin fiction, and it deals with class and the vulnerability of its characters, which Intermezzo takes up again through age and class differences in its pairings. You have no Notes on it, so this link rests on the books' descriptions.
- thematic/moderate → The Plague: The Plague is about finding meaning and solidarity in the face of mortality and loss, which echoes Intermezzo's concern with finding meaning after bereavement. The two differ sharply in scale and tone, since one is public catastrophe and the other private grief.
- thematic/weak → Everything I Know About Love: Both books treat relationships as central to getting through hard stretches of adult life. Your Note on this one, "love isn't just romance, cherish friendships", loosely parallels the brothers' bond in Intermezzo.
- contrast/weak → The Stranger: The Stranger presents a death with emotional detachment and sparse prose, while Intermezzo dwells in the interior life of grieving brothers. The contrast in how each treats mourning may be worth noting.

**Haiku**
- context/strong → Beautiful World, Where Are You: Both are Sally Rooney novels set in Dublin that explore intimacy, desire, and emotional vulnerability through carefully observed internal lives. Your note that Intermezzo "gets better every reread, immersed in peter's stream of consciousness" reflects the same kind of psychological depth Rooney brings to her other characters, and the examination of romantic entanglement across both novels creates a natural pairing in her body of work.
- thematic/strong → Normal People: Both novels trace how class differences and emotional vulnerability shape romantic relationships over time, with characters repeatedly drawn together despite their attempts to separate. Like Peter in Intermezzo navigating desire and loss, Connell and Marianne's bond persists through shame and self-doubt, examining the gap between what characters feel and what they can express.
- thematic/moderate → Kafka on the Shore: Both novels meditate on meaning-making after displacement and loss. Your observation that Murakami "weaves smoothly between reality and dream, using rivers and transitions as metaphor" parallels how Intermezzo uses the brothers' grief as a threshold between states of being, with both works finding significance in the passage through darkness rather than resolution.

### Candide (no Notes)
**Sonnet**
- thematic/strong → The Plague: Both books confront sudden catastrophe and the problem of suffering, and both end by favouring action over philosophy: Camus through solidarity and small acts of resistance, Voltaire through Candide's turn toward practical work.
- thematic/moderate → The Stranger: Both are short, deadpan novels that set a detached protagonist against a world with no reassuring order, and both deliver their critique through understated, absurd events rather than direct argument.
- thematic/moderate → Blindness: Saramago's epidemic exposes how thin social order and moral confidence are, much as Voltaire's catastrophes undercut comfortable optimism and blind acceptance. Both use a fable-like scenario to criticize how people fail to see what is in front of them.
- context/weak → The Wind-Up Bird Chronicle: Toru Okada drifts from place to place and episode to episode, which loosely resembles Candide's picaresque wandering. The link is mostly structural, since the tone and purpose of the two books differ greatly.

**Haiku**
- thematic/strong → The Plague: Both works use catastrophic events—plague and natural disasters—as vehicles to explore how humans confront suffering, meaninglessness, and the inadequacy of inherited philosophies. The Plague directly mirrors Candide's preoccupation with whether meaning can be found when disaster is relentless and indifferent.
- thematic/strong → The Stranger: Candide and The Stranger both grapple with absurdism and the problem of meaning in an indifferent world. Voltaire's satirical demolition of optimistic philosophy finds its philosophical complement in Camus's exploration of how Meursault must confront a universe where his emotions and actions carry no inherent significance.
- contrast/moderate → Blindness: Blindness and Candide both depict societies collapsing under calamity, but where Voltaire uses satire to mock philosophical blindness to reality, Saramago treats literal blindness as a metaphor for moral and social breakdown, offering a more somber meditation on human vulnerability rather than Voltaire's cutting irony.

### Convenience Store Woman (has Notes)
**Sonnet**
- thematic/strong → The Stranger: Both books center on a detached narrator whose lack of conventional feeling sets them apart from the society around them. Meursault's flat, matter-of-fact outlook echoes Keiko's, and each novel asks what society does to someone who doesn't perform the expected emotions.
- thematic/moderate → The Wind-Up Bird Chronicle: Toru Okada withdraws from ordinary working life and drifts in disconnection from society, while Keiko clings to work as her anchor. Both are Japanese novels about a person standing at an odd angle to what is considered a normal adult life. You noted that Murakami's book "questions whether or not we are truly free", which is also a question about Keiko's script-following life.
- contrast/moderate → Everything I Know About Love: Both books look at women's adult lives and the pressure to fit an expected shape. Alderton answers it with friendship, honesty and messy self-acceptance, while Keiko answers it by performing a role. You wrote "love isn't just romance, cherish friendships", which sits against Keiko's society pressing her toward romance and marriage.
- thematic/weak → Candide: Both use dark, deadpan humor to satirize social expectations and the acceptance of the status quo. Candide mocks blind optimism, while Convenience Store Woman gently mocks what counts as a normal life. You found the latter "pretty funny but didn't fully get the point", and satire like Voltaire's may help frame that point.
- thematic/weak → Normal People: Normal People explores the gap between public and private selves and how shame shapes honesty, which loosely parallels Keiko's performed self versus her real one. The link is narrower, since Rooney's focus is romance rather than conformity.

**Haiku**
- thematic/strong → Everything I Know About Love: Both books examine what it means to live authentically as an adult rather than conforming to external expectations. Alderton explores how women navigate this tension through memoir, while Murata dramatizes it through Keiko's performance of normalcy at the convenience store—both writers asking whether meeting society's standards is worth the cost of self-erasure.
- thematic/moderate → Intermezzo: Both novels focus on characters finding stability and meaning through routines and roles, though Rooney explores grief as the catalyst for Peter's examination of how to live, while Murata shows Keiko already settled into her role. Both use close attention to interior consciousness to reveal how structure can provide comfort.
- thematic/moderate → The Stranger: Both Keiko and Meursault are emotionally detached figures whose alienation from conventional society forms the core of their respective narratives. The convenience store manual functions for Keiko much as Meursault's emotional indifference does for him—as a script that distances them from normal social performance.

### My Brilliant Friend (no Notes)
**Sonnet**
- thematic/strong → Everything I Know About Love: Both books treat female friendship as a central, formative relationship in a woman's life. Your note "love isn't just romance, cherish friendships" echoes what My Brilliant Friend puts at its center.
- thematic/moderate → Beautiful World, Where Are You: Beautiful World, Where Are You pairs friendship and loyalty with class and privilege, as My Brilliant Friend does through two girls' bond. Its emails between friends give the friendship a direct voice, which you singled out as "emails were a highlight".
- thematic/moderate → Normal People: Normal People, like My Brilliant Friend, follows a lifelong bond between two people from a young age, with class differences shaping how they relate. The bond there is romantic rather than a friendship between girls.
- thematic/weak → Convenience Store Woman: Both books look at the expectations society places on women and the pressure to conform to them, though Convenience Store Woman does so through satire and one woman's solitary routine rather than a friendship.

**Haiku**
- thematic/strong → Normal People: Both My Brilliant Friend and Normal People center on young people navigating class differences and social shame within intimate relationships, tracing how these forces shape their connections and self-understanding over time.
- thematic/moderate → Everything I Know About Love: Both works emphasize female friendship as a primary relationship and explore the messy reality of growing up, particularly how women support each other through life's challenges.
- context/moderate → Intermezzo: Like My Brilliant Friend, Intermezzo is a contemporary literary work centered on young people in a specific place (Dublin for Rooney, Naples for Ferrante) examining how they navigate relationships and loss.

### The Unbearable Lightness of Being (has Notes)
**Sonnet**
- thematic/moderate → The Plague: Both novels set individual lives against sudden upheaval and treat contingency and mortality as central concerns. Your note on Kundera's "thoughts on lightness vs weight, especially when it comes to coincidence" echoes the Camus novel's themes of contingency and meaning in the face of chance catastrophe.
- thematic/moderate → The Stranger: Both are philosophical novels about meaning and meaninglessness. Meursault's detachment and Kundera's weightlessness each ask how to live when nothing seems to carry inherent weight.
- contrast/moderate → Candide: Both are philosophical novels that use fiction to test big ideas, and Voltaire mocks the idea that everything happens for the best. Kundera's eternal return and contingency answer that question in a more meditative, ambivalent way, and Candide ends by favoring action over philosophy.
- thematic/weak → The Wind-Up Bird Chronicle: Your note on this book says it "questions whether or not we are truly free," which touches on the paradox of freedom in Kundera. Both novels also drift between characters and strange or unexplained events in a loose, non-linear way.

**Haiku**
- thematic/strong → The Plague: Both The Plague and The Unbearable Lightness of Being grapple with contingency and the tension between meaning-making and meaninglessness in human existence. Camus's epidemic forces characters to confront sudden mortality and absurdity much as Kundera's exploration of eternal return forces readers to reckon with how contingency shapes whether existence feels weighted or weightless.
- thematic/moderate → The Stranger: Both novels present protagonists whose emotional detachment or alienation forces confrontation with questions of meaning and authenticity in an indifferent world. Like Kundera's meditation on lightness and weight, Camus's sparse style and Meursault's distance raise fundamental questions about what gives existence significance.
- thematic/moderate → Kafka on the Shore: Both use metaphor and a fragmented, essayistic approach to explore interconnection and meaning. Your note that you loved Kundera's writing on "lightness vs weight, especially when it comes to coincidence" resonates with Murakami's weaving of parallel lives and mysterious connections—two narratives that intersect in unexpected ways rather than through conventional causality.
- contrast/moderate → Blindness: Where Kundera emphasizes the philosophical weight of individual choice and the tension between lightness and heaviness, Saramago's blindness strips away the distinctions between self and collective, between visible and invisible meaning. Both use distinctive prose styles to disorient and estrange, but toward opposing inquiries: Kundera into the burden of consciousness, Saramago into the dissolution of it.

### My Year of Rest and Relaxation (has Notes)
**Sonnet**
- thematic/strong → The Stranger: Both books centre on a detached narrator who withdraws emotionally from the people around her or him, and whose alienation the narration presents without apology. Moshfegh's protagonist and Meursault both leave you judging them while still following their logic, which echoes your note that she is "somehow a terrible person but understandable".
- thematic/strong → The Wind-Up Bird Chronicle: Toru Okada withdraws from ordinary life after losing his job, and the book slides between domestic realism and dreamlike episodes. That matches the dreamlike quality you noted in Moshfegh: "snippets felt like a dream".
- thematic/moderate → Convenience Store Woman: Both follow a woman who opts out of what society expects of her, in one case through a rigid job and in the other through chemical hibernation. Both also use a flat, darkly comic tone around alienation, which may be useful given that you didn't fully get the point of Convenience Store Woman.
- context/weak → Kafka on the Shore: Kafka on the Shore blends the mundane with the surreal and features characters who run away or retreat from their lives. This is a looser link to the dreamlike feel you noted in Moshfegh.
- contrast/weak → Intermezzo: Intermezzo is also about people dealing with emotional pain, but its characters respond by reaching toward life and connection, as in your note about it: "pursue living through the dark times". Moshfegh's narrator answers her unhappiness by trying to sleep through it.

**Haiku**
- thematic/strong → The Wind-Up Bird Chronicle: Both novels center on protagonists who withdraw from ordinary life into states of disconnection and dreamlike disorientation. You noted that My Year of Rest and Relaxation "snippets felt like a dream," and similarly The Wind-Up Bird Chronicle moves "between realistic domestic scenes and surreal, dreamlike episodes" as Okada drifts through isolation. **[INVALID: between realistic domestic scenes and surreal, dreamlike episodes]**
- thematic/moderate → The Unbearable Lightness of Being: Both works explore the tension between withdrawal and engagement with life, and use fragmented, essayistic styles to examine existence. Your appreciation for Kundera's "thoughts on lightness vs weight" resonates with the novel's meditation on how the protagonist's pharmaceutical escape represents an attempt to shed the weight of meaningful engagement.
- contrast/moderate → Convenience Store Woman: Both novels feature protagonists who are socially alienated and perform versions of themselves to function in society, but respond oppositely: Keiko finds comfort in her convenience store routine despite not fitting expectations, while Moshfegh's protagonist actively rejects engagement. Your note that you "didn't fully get the point" of Convenience Store Woman makes this a useful counterpoint to your experience of My Year of Rest and Relaxation.
- thematic/moderate → Kafka on the Shore: Like My Year of Rest and Relaxation, Kafka on the Shore blends the mundane with the surreal and explores isolation and longing. Your observation that Murakami "weaves smoothly between reality and dream" applies equally to Moshfegh's dream-like narrative, and both authors use altered consciousness and disconnection as central experiences.

### The Sirens of Titan (has Notes)
**Sonnet**
- thematic/strong → Candide: Both are darkly comic satires in which characters are tossed about by forces beyond their control, and both land on making something of life through action rather than grand explanation. Candide's arc of finding meaning through action echoes Vonnegut's absurdist conclusion.
- thematic/strong → The Stranger: Both confront an indifferent universe and the absurd, asking what meaning remains when human life seems insignificant. Camus answers with detachment and starkness where Vonnegut uses sci-fi comedy.
- thematic/strong → The Unbearable Lightness of Being: Both novels dwell on contingency and the paradox of freedom, with lives shaped by coincidence and larger forces. Your note on Kundera, "really liked the thoughts on lightness vs weight, especially when it comes to coincidence", fits Vonnegut's treatment of chance and manipulation.
- thematic/moderate → The Wind-Up Bird Chronicle: You wrote that Murakami's novel "questions whether or not we are truly free", which is the question of free will and manipulation at the heart of Malachi's cosmic journey. Both also drift through inexplicable events driven by mysterious forces.
- thematic/moderate → The Plague: Both treat human insignificance and the absurd, but Camus finds meaning in solidarity and defiance, an answer that resonates with Vonnegut's emphasis on connection against cosmic loneliness.
- context/weak → Kafka on the Shore: Both blend the fantastical with the everyday and follow characters carried along by forces they do not understand, searching for meaning.

**Haiku**
- thematic/strong → The Unbearable Lightness of Being: Both novels grapple with fundamental questions about meaning and human agency in an indifferent universe. Your note that you should "make the most of it" when things are outside your control directly echoes Kundera's exploration of how we find weight and significance in a contingent existence, much like Vonnegut's characters must navigate their cosmic insignificance.
- thematic/strong → Candide: Like The Sirens of Titan, Candide uses dark humor and absurdist catastrophes to interrogate philosophical naivety about meaning and control. Both novels follow protagonists through disorienting journeys that strip away illusions and force them to confront an indifferent world—Voltaire through relentless satire, Vonnegut through science fiction.
- thematic/strong → The Stranger: Both novels confront absurdism and the search for meaning in a world where human significance is minimal and systems of control are beyond individual influence. Camus's sparse, detached narrative style parallels Vonnegut's darkly comic treatment of human insignificance and the impossibility of true free will.
- thematic/moderate → Kafka on the Shore: Both novels use fantastical journeys and dreamlike narratives to explore isolation and the search for meaning, blending the surreal with philosophical inquiry. Your observation that Murakami "weaves smoothly between reality and dream" describes a technique Vonnegut also employs through his freewheeling, nonlinear storytelling.
- thematic/moderate → The Plague: Both novels use catastrophic scenarios to explore how humans find meaning and connection in the face of cosmic indifference and forces beyond individual control. The Plague presents collective human response to absurdity in ways that echo Vonnegut's treatment of existential helplessness, though Camus offers more emphasis on solidarity.

### Norwegian Wood (has Notes)
**Sonnet**
- context/strong → The Wind-Up Bird Chronicle: Same author, and both follow a drifting, withdrawn Murakami narrator whose life is unsettled by a woman's absence. Your note on this one, "Okada drifts from story to story, place to place", fits Watanabe's passive, melancholy movement through Tokyo.
- context/moderate → Kafka on the Shore: Another Murakami novel about loneliness, memory and a young person searching for meaning. Norwegian Wood is realist where this one is magical, which makes it a useful comparison with your note about how Murakami weaves "between reality and dream".
- thematic/strong → Intermezzo: Both center on a man working through grief while tangled in relationships with different women, and both are intimate and interior. Your note on this one, "pursue living through the dark times", echoes the growth through love you noted in Norwegian Wood.
- thematic/moderate → My Year of Rest and Relaxation: Both portray alienation and withdrawal from the world in a protagonist who is hard to pin down morally. This one is a deliberate retreat, while Watanabe is pulled into isolation by loss.
- thematic/moderate → Normal People: Both are coming-of-age love stories about young people drawn to each other while carrying fragility and self-doubt, and the gap between public and private selves is a theme in each. Normal People is spare and dialogue-driven where Norwegian Wood is wistfully retrospective.
- thematic/weak → The Unbearable Lightness of Being: Both are set against political upheaval in the 1960s and pair love with questions of weight and meaning. Kundera's book is far more essayistic, and the student unrest in Norwegian Wood is a backdrop that you read as ironic.

**Haiku**
- context/strong → The Wind-Up Bird Chronicle: Both are Murakami novels exploring isolation and disconnection; you noted that Okada in Wind-Up Bird Chronicle "drifts from story to story," which parallels Watanabe's disorientation navigating grief and emotional disconnection in Norwegian Wood.
- context/strong → Kafka on the Shore: Another Murakami work that shares his signature blending of reality and dream; you observed how Murakami "weaves smoothly between reality and dream, using rivers and transitions as metaphor," a technique central to Norwegian Wood's nostalgic structure.
- thematic/strong → Intermezzo: Both novels are meditations on grief and how to "pursue living through the dark times," as you noted about Intermezzo; they share an exploration of loss, desire, and emotional vulnerability as paths toward meaning and connection.
- thematic/moderate → The Unbearable Lightness of Being: Both examine how contingency and chance shape human connection and meaning; your appreciation for Kundera's "thoughts on lightness vs weight, especially when it comes to coincidence" resonates with Norwegian Wood's exploration of how random encounters determine emotional trajectories.
- thematic/moderate → Normal People: Like Norwegian Wood, Normal People traces how class, shame, and self-doubt complicate the search for emotional connection and meaning; both novels examine the gap between desire and the possibility of genuine intimacy across time and circumstance.

### Inverting the Pyramid (no Notes)
**Sonnet**
- thematic/weak → The Course: Both books deal with strategy in a competitive game and how innovators break from standard approaches: Wilson follows coaches whose tactical ideas spread and changed soccer, while Miller's poker book pushes players to think differently from conventional play.

**Haiku**
- thematic/strong → The Course: Both Inverting the Pyramid and The Course explore how innovation and unconventional thinking drive success in competitive domains. Wilson traces how coaches who broke from established norms—like Chapman's W-M formation or Michels's Total Football—transformed soccer, paralleling Miller's focus on developing unique approaches rather than following standard strategy.

### Set My Heart on Fire
_No Connections from either model._

## 5. Strength floor, per-run cap, candidate count

Edges and degree are over all 19 Books. "Books with same-theme edge" is how many of the 17 themed Books got at least one edge to a same-theme Book. Isolated Books (The Course, Inverting the Pyramid) should have none.

| Run / floor / cap | Edges | Mean degree | Max degree | Same-theme edge share | Themed Books with same-theme edge | Books with no Connections |
|---|---|---|---|---|---|---|
| sonnet12 floor=strong cap=3 | 16 | 1.68 | 4 | 0.75 | 14/17 | The Course, Inverting the Pyramid, Set My Heart on Fire |
| sonnet12 floor=strong cap=5 | 16 | 1.68 | 4 | 0.75 | 14/17 | The Course, Inverting the Pyramid, Set My Heart on Fire |
| sonnet12 floor=strong cap=8 | 16 | 1.68 | 4 | 0.75 | 14/17 | The Course, Inverting the Pyramid, Set My Heart on Fire |
| sonnet12 floor=moderate cap=3 | 33 | 3.47 | 8 | 0.61 | 15/17 | The Course, Inverting the Pyramid, Set My Heart on Fire |
| sonnet12 floor=moderate cap=5 | 37 | 3.89 | 8 | 0.59 | 15/17 | The Course, Inverting the Pyramid, Set My Heart on Fire |
| sonnet12 floor=moderate cap=8 | 37 | 3.89 | 8 | 0.59 | 15/17 | The Course, Inverting the Pyramid, Set My Heart on Fire |
| sonnet12 floor=weak cap=3 | 37 | 3.89 | 9 | 0.57 | 15/17 | Set My Heart on Fire |
| sonnet12 floor=weak cap=5 | 50 | 5.26 | 11 | 0.5 | 15/17 | Set My Heart on Fire |
| sonnet12 floor=weak cap=8 | 52 | 5.47 | 11 | 0.5 | 16/17 | Set My Heart on Fire |
| sonnet6 floor=strong cap=3 | 12 | 1.26 | 3 | 0.92 | 14/17 | The Course, Convenience Store Woman, Inverting the Pyramid, Set My Heart on Fire |
| sonnet6 floor=strong cap=5 | 12 | 1.26 | 3 | 0.92 | 14/17 | The Course, Convenience Store Woman, Inverting the Pyramid, Set My Heart on Fire |
| sonnet6 floor=strong cap=8 | 12 | 1.26 | 3 | 0.92 | 14/17 | The Course, Convenience Store Woman, Inverting the Pyramid, Set My Heart on Fire |
| sonnet6 floor=moderate cap=3 | 29 | 3.05 | 8 | 0.66 | 15/17 | The Course, Inverting the Pyramid, Set My Heart on Fire |
| sonnet6 floor=moderate cap=5 | 30 | 3.16 | 8 | 0.67 | 15/17 | The Course, Inverting the Pyramid, Set My Heart on Fire |
| sonnet6 floor=moderate cap=8 | 30 | 3.16 | 8 | 0.67 | 15/17 | The Course, Inverting the Pyramid, Set My Heart on Fire |
| sonnet6 floor=weak cap=3 | 36 | 3.79 | 11 | 0.58 | 15/17 | Set My Heart on Fire |
| sonnet6 floor=weak cap=5 | 41 | 4.32 | 12 | 0.54 | 15/17 | Set My Heart on Fire |
| sonnet6 floor=weak cap=8 | 41 | 4.32 | 12 | 0.54 | 15/17 | Set My Heart on Fire |
| sonnet3 floor=strong cap=3 | 10 | 1.05 | 3 | 1 | 14/17 | The Course, Convenience Store Woman, The Unbearable Lightness of Being, Inverting the Pyramid, Set My Heart on Fire |
| sonnet3 floor=strong cap=5 | 10 | 1.05 | 3 | 1 | 14/17 | The Course, Convenience Store Woman, The Unbearable Lightness of Being, Inverting the Pyramid, Set My Heart on Fire |
| sonnet3 floor=strong cap=8 | 10 | 1.05 | 3 | 1 | 14/17 | The Course, Convenience Store Woman, The Unbearable Lightness of Being, Inverting the Pyramid, Set My Heart on Fire |
| sonnet3 floor=moderate cap=3 | 22 | 2.32 | 7 | 0.68 | 14/17 | The Course, Inverting the Pyramid, Set My Heart on Fire |
| sonnet3 floor=moderate cap=5 | 22 | 2.32 | 7 | 0.68 | 14/17 | The Course, Inverting the Pyramid, Set My Heart on Fire |
| sonnet3 floor=moderate cap=8 | 22 | 2.32 | 7 | 0.68 | 14/17 | The Course, Inverting the Pyramid, Set My Heart on Fire |
| sonnet3 floor=weak cap=3 | 32 | 3.37 | 10 | 0.56 | 14/17 | Set My Heart on Fire |
| sonnet3 floor=weak cap=5 | 32 | 3.37 | 10 | 0.56 | 14/17 | Set My Heart on Fire |
| sonnet3 floor=weak cap=8 | 32 | 3.37 | 10 | 0.56 | 14/17 | Set My Heart on Fire |
| haiku12 floor=strong cap=3 | 20 | 2.11 | 5 | 0.65 | 13/17 | Set My Heart on Fire |
| haiku12 floor=strong cap=5 | 20 | 2.11 | 5 | 0.65 | 13/17 | Set My Heart on Fire |
| haiku12 floor=strong cap=8 | 20 | 2.11 | 5 | 0.65 | 13/17 | Set My Heart on Fire |
| haiku12 floor=moderate cap=3 | 36 | 3.79 | 6 | 0.56 | 15/17 | Set My Heart on Fire |
| haiku12 floor=moderate cap=5 | 42 | 4.42 | 7 | 0.57 | 16/17 | Set My Heart on Fire |
| haiku12 floor=moderate cap=8 | 42 | 4.42 | 7 | 0.57 | 16/17 | Set My Heart on Fire |
| haiku12 floor=weak cap=3 | 36 | 3.79 | 6 | 0.56 | 15/17 | Set My Heart on Fire |
| haiku12 floor=weak cap=5 | 42 | 4.42 | 7 | 0.57 | 16/17 | Set My Heart on Fire |
| haiku12 floor=weak cap=8 | 42 | 4.42 | 7 | 0.57 | 16/17 | Set My Heart on Fire |

The judge token budget (600 vs 150 tokens per candidate) made no difference: every Note here is shorter than 150 tokens, so the prompts were identical.

## 6. Clusters

### Louvain resolution sweep (all 19 Books, Sonnet K=12, floor=moderate, cap=5)

- **resolution 1**: 6 Books [love:6] · 5 Books [absurd:4 love:1] · 5 Books [dream:4 absurd:1]
- **resolution 2**: 5 Books [love:5] · 5 Books [absurd:4 love:1] · 3 Books [dream:2 love:1] · 3 Books [dream:2 absurd:1]
- **resolution 0.5**: 5 Books [love:5] · 11 Books [absurd:5 dream:4 love:2]
- **resolution 0.75**: 5 Books [love:5] · 5 Books [absurd:4 love:1] · 6 Books [dream:4 love:1 absurd:1]
- **resolution 1.5**: 5 Books [love:5] · 5 Books [absurd:4 love:1] · 3 Books [dream:2 love:1] · 3 Books [dream:2 absurd:1]

### Replay: Books added one at a time (resolution 1, Jaccard match ≥ 0.5, rename at ≥ 30% change)

- n=4 +Everything I Know About Love → 0 Cluster(s). (no change)
- n=5 +The Stranger → 1 Cluster(s). NEW #1 "Meaning in an Indifferent World" (3 Books)
- n=6 +The Course → 1 Cluster(s). (no change)
- n=7 +Beautiful World, Where Are You → 2 Cluster(s). NEW #2 "Tender Misunderstandings" (3 Books)
- n=8 +Kafka on the Shore → 2 Cluster(s). kept #1 "Meaning in an Indifferent World" (change 25%, J=0.75)
- n=9 +Blindness → 2 Cluster(s). kept #1 "Meaning in an Indifferent World" (change 20%, J=0.80)
- n=10 +Intermezzo → 2 Cluster(s). kept #2 "Tender Misunderstandings" (change 25%, J=0.75)
- n=11 +Candide → 2 Cluster(s). RENAME #1 "Meaning in an Indifferent World" -> "Absurd Catastrophe, Human Response" (change 50%, J=0.50)
- n=12 +Convenience Store Woman → 3 Cluster(s). kept #1 "Absurd Catastrophe, Human Response" (change 25%, J=0.75) · NEW #3 "Strangers Among the Ordinary" (4 Books)
- n=13 +My Brilliant Friend → 3 Cluster(s). kept #2 "Tender Misunderstandings" (change 20%, J=0.80)
- n=14 +The Unbearable Lightness of Being → 3 Cluster(s). kept #1 "Absurd Catastrophe, Human Response" (change 25%, J=0.75)
- n=15 +My Year of Rest and Relaxation → 3 Cluster(s). kept #3 "Strangers Among the Ordinary" (change 20%, J=0.80)
- n=16 +The Sirens of Titan → 3 Cluster(s). kept #1 "Absurd Catastrophe, Human Response" (change 20%, J=0.80)
- n=17 +Norwegian Wood → 3 Cluster(s). kept #2 "Tender Misunderstandings" (change 17%, J=0.83)
- n=18 +Inverting the Pyramid → 3 Cluster(s). (no change)
- n=19 +Set My Heart on Fire → 3 Cluster(s). (no change)

### Final Clusters (generated names and descriptions)

- **Tender Misunderstandings** (Beautiful World, Where Are You; My Brilliant Friend; Everything I Know About Love; Intermezzo; Normal People; Norwegian Wood). Young adults fumble toward intimacy, in friendships and romances alike, held back by what they can't say aloud. Each book shows how attachment, insecurity, and the distance between private and public selves shape the search for connection.
- **Absurd Catastrophe, Human Response** (Blindness; Candide; The Plague; The Sirens of Titan; The Unbearable Lightness of Being). Works that confront suffering and a meaningless or indifferent world, questioning comforting beliefs and social systems. They find what dignity there is in solidarity, action, and lucid defiance rather than in faith or optimism.
- **Strangers Among the Ordinary** (Convenience Store Woman; Kafka on the Shore; My Year of Rest and Relaxation; The Stranger; The Wind-Up Bird Chronicle). Detached protagonists drift at the edges of society, unsure of their place or purpose in a world that expects conformity. Through routine, surrealism, or indifference, each confronts the gap between living a normal life and finding any real meaning in it.
