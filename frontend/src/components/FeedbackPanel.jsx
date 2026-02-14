/**
 * FeedbackPanel Component for aitherhub
 *
 * Displays thumbs up/down buttons for each analysis phase,
 * allowing users to rate the quality of AI analysis results.
 * Feedback is sent to the backend API and updates the RAG
 * knowledge base quality scores.
 *
 * Add this file to: frontend/src/components/FeedbackPanel.jsx
 */

import React, { useState } from 'react';

const API_BASE = import.meta.env.VITE_API_BASE_URL || '';

const FeedbackPanel = ({ videoId, phaseIndex, phaseName }) => {
  const [rating, setRating] = useState(null);
  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [qualityScore, setQualityScore] = useState(null);

  const submitFeedback = async (selectedRating) => {
    setSubmitting(true);
    try {
      const response = await fetch(`${API_BASE}/api/v1/feedback/`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          video_id: videoId,
          phase_index: phaseIndex,
          rating: selectedRating,
        }),
      });

      if (!response.ok) throw new Error('Feedback submission failed');

      const data = await response.json();
      setRating(selectedRating);
      setSubmitted(true);
      setQualityScore(data.new_quality_score);
    } catch (error) {
      console.error('Failed to submit feedback:', error);
      alert('フィードバックの送信に失敗しました');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div style={{
      display: 'flex',
      alignItems: 'center',
      gap: '8px',
      padding: '8px 12px',
      borderRadius: '8px',
      backgroundColor: 'rgba(255, 255, 255, 0.05)',
    }}>
      <span style={{
        fontSize: '12px',
        color: 'rgba(255, 255, 255, 0.6)',
        marginRight: '4px',
      }}>
        この分析は役立ちましたか？
      </span>

      <button
        onClick={() => submitFeedback(1)}
        disabled={submitting || submitted}
        style={{
          background: rating === 1 ? '#22c55e' : 'rgba(255, 255, 255, 0.1)',
          border: 'none',
          borderRadius: '6px',
          padding: '4px 10px',
          cursor: submitted ? 'default' : 'pointer',
          fontSize: '16px',
          opacity: submitting ? 0.5 : 1,
          transition: 'all 0.2s',
        }}
        title="良い分析"
      >
        👍
      </button>

      <button
        onClick={() => submitFeedback(-1)}
        disabled={submitting || submitted}
        style={{
          background: rating === -1 ? '#ef4444' : 'rgba(255, 255, 255, 0.1)',
          border: 'none',
          borderRadius: '6px',
          padding: '4px 10px',
          cursor: submitted ? 'default' : 'pointer',
          fontSize: '16px',
          opacity: submitting ? 0.5 : 1,
          transition: 'all 0.2s',
        }}
        title="改善が必要"
      >
        👎
      </button>

      {submitted && (
        <span style={{
          fontSize: '11px',
          color: '#22c55e',
          marginLeft: '4px',
        }}>
          ✓ 記録しました
        </span>
      )}
    </div>
  );
};

export default FeedbackPanel;
