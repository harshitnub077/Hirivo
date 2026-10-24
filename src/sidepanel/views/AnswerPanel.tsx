import React, { useMemo, useState } from 'react';
import { Check, Copy, RefreshCw, Sparkles } from 'lucide-react';
import { JobSnapshot, ResumeFact, UserSettings, VoiceProfile } from '../../db';
import { AnswerMode, QUESTION_PRESETS, writeAnswer } from '../../services/answerWriter';
import { checkGrounding } from '../../services/proofWriter';
import { lintOutreachText } from '../../services/phraseLinter';
import { stripCitations } from '../../services/outreach';
import { Callout, Field, Pill, Segmented, useCopy } from '../ui';
import type { ViewId } from '../App';

interface Props {
  job: JobSnapshot;
  facts: ResumeFact[];
  voiceProfile?: VoiceProfile;
  settings: UserSettings;
  hasKey: boolean;
  goTo: (v: ViewId) => void;
}

/** Application questions and cover letters, backed by resume facts. */
export function AnswerPanel({ job, facts, voiceProfile, settings, hasKey, goTo }: Props) {
  const [mode, setMode] = useState<AnswerMode>('answer');
  const [question, setQuestion] = useState('');
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copied, copy] = useCopy();

  const grounding = useMemo(() => checkGrounding(text, facts, { company: job.company, hasHook: false }), [text, facts, job.company]);
  const lint = useMemo(() => lintOutreachText(text), [text]);
  const words = stripCitations(text).split(/\s+/).filter(Boolean).length;

  if (!hasKey || facts.length === 0) {
    return (
      <Callout>
        {!hasKey ? 'Answers need a free AI key.' : 'Add your resume first. Answers only use facts your resume backs up.'}
        <div style={{ marginTop: 8 }}>
          <button className="btn sm" onClick={() => goTo('you')}>Open You</button>
        </div>
      </Callout>
    );
  }

  const generate = async () => {
    setBusy(true);
    setError(null);
    try {
      const r = await writeAnswer({
        mode,
        question,
        jobTitle: job.title,
        companyName: job.company,
        facts,
        voiceProfile,
        senderName: settings.userFullName,
        requirements: (job.fitEvidence || []).sort((a, b) => Number(b.met) - Number(a.met)).map((r) => r.text),
      });
      setText(r.text);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="stack">
      <section className="card stack">
        <Segmented<AnswerMode>
          label="What to write"
          value={mode}
          onChange={(m) => {
            setMode(m);
            setText('');
          }}
          options={[
            { value: 'answer', label: 'Application question' },
            { value: 'cover', label: 'Cover letter' },
          ]}
        />
        {mode === 'answer' && (
          <>
            <div className="row wrap" style={{ gap: 6 }}>
              {QUESTION_PRESETS.map((q) => (
                <button key={q} className="btn sm" onClick={() => setQuestion(q)}>
                  {q}
                </button>
              ))}
            </div>
            <Field label="Question from the form">
              <textarea rows={2} value={question} onChange={(e) => setQuestion(e.target.value)} placeholder="Paste the question here" />
            </Field>
          </>
        )}
        <button className="btn primary block" onClick={generate} disabled={busy || (mode === 'answer' && !question.trim())}>
          {busy ? <RefreshCw size={14} className="spin" /> : <Sparkles size={14} />} {busy ? 'Writing from your facts…' : mode === 'cover' ? 'Write cover letter' : 'Write answer'}
        </button>
        {error && <Callout tone="caution">{error}</Callout>}
      </section>

      {text && (
        <section className="card stack fade-in">
          <div className="row between">
            <div className="h2">{mode === 'cover' ? 'Cover letter' : 'Answer'}</div>
            <div className="row" style={{ gap: 6 }}>
              <Pill>{words} words</Pill>
              <Pill tone={lint.issues.length ? 'caution' : 'ok'}>{lint.issues.length ? `${lint.issues.length} cliché${lint.issues.length > 1 ? 's' : ''}` : 'Sounds human'}</Pill>
            </div>
          </div>
          <textarea rows={mode === 'cover' ? 14 : 7} value={text} onChange={(e) => setText(e.target.value)} />
          {grounding.unverifiedClaimsCount > 0 && (
            <Callout tone="risk">
              <b>Check before using:</b>
              <ul className="checklist" style={{ marginTop: 6 }}>
                {grounding.groundedSentences
                  .filter((s) => !s.isGrounded)
                  .map((s, i) => (
                    <li key={i}>
                      “{s.sentence}” <span className="muted">{s.warning}</span>
                    </li>
                  ))}
              </ul>
            </Callout>
          )}
          <button className="btn" onClick={() => copy('answer', stripCitations(text))}>
            {copied === 'answer' ? <Check size={14} /> : <Copy size={14} />} Copy without fact tags
          </button>
        </section>
      )}
    </div>
  );
}
