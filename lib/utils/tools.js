export function normalizeQuestions(rawData){
  return rawData.map((question) => {
    // Sicherstellen, dass das answers-Array existiert
    const answers = question.answers || [];

    return {
      _id: question._id,
      question_text: question.question_text,
      // Wir weisen die Antworten basierend auf ihrer Position im Array zu
      antwort1: answers[0]?.answer_text || "",
      antwort2: answers[1]?.answer_text || "",
      antwort3: answers[2]?.answer_text || "",
      antwort4: answers[3]?.answer_text || "",
    };
  });
};
