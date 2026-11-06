/* موتور خودآزمون: متن از خودِ manifest خوانده می‌شود. هدف فقط این است که ثابت شود لوله‌ی اندازه‌گیری
   (نرمال‌سازی، WER، فیلدها) درست کار می‌کند — نه اینکه دقت گفتار سنجیده شده باشد. */
export const name = 'human';
export async function create() {
  return {
    name,
    needsAudio: false,
    async transcribe(sample) {
      const text = sample.engineText ?? sample.reference;
      if (!text) throw new Error(`نمونه‌ی ${sample.id}: reference/engineText ندارد.`);
      return { text };
    },
    async dispose() {},
  };
}
