// Modified from AionCore by WINK GO contributors in 2026.
use serde::Deserialize;

/// Body for `POST /api/conversations/:id/asks/:requestId/answer`.
#[derive(Debug, Deserialize)]
pub struct AskAnswerRequest {
    #[serde(default)]
    pub answers: Vec<AskQuestionAnswer>,
    #[serde(default)]
    pub decline: bool,
}

/// One answer keyed by the exact question text expected by the agent protocol.
#[derive(Debug, Deserialize)]
pub struct AskQuestionAnswer {
    pub question: String,
    pub labels: Vec<String>,
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn keeps_multi_select_answers() {
        let request: AskAnswerRequest = serde_json::from_value(serde_json::json!({
            "answers": [{ "question": "Which?", "labels": ["A", "B"] }]
        }))
        .unwrap();
        assert!(!request.decline);
        assert_eq!(request.answers[0].labels, ["A", "B"]);
    }

    #[test]
    fn decline_stays_distinct_from_empty_answers() {
        let request: AskAnswerRequest = serde_json::from_value(serde_json::json!({ "decline": true })).unwrap();
        assert!(request.decline);
        assert!(request.answers.is_empty());
    }
}
