import React, { useState, useMemo, useCallback } from 'react';

const App: React.FC = () => {
  return (
    <div style={{ padding: '40px', backgroundColor: '#1e293b', color: 'white', minHeight: '100vh' }}>
      <h1>✅ Predii Spec-RAG is Loading</h1>
      <p>If you see this, React is working correctly.</p>
      <div style={{ marginTop: '30px', padding: '20px', backgroundColor: '#334155', borderRadius: '8px' }}>
        <h2>System Status</h2>
        <ul>
          <li>✓ Frontend: React + Tailwind CSS</li>
          <li>✓ Dev Server: Vite</li>
          <li>✓ LLM: OpenAI GPT-3.5-Turbo</li>
          <li>✓ Embeddings: text-embedding-3-small</li>
        </ul>
      </div>
    </div>
  );
};

export default App;
