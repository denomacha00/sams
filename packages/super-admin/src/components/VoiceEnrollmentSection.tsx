import React, { useState, useEffect, useCallback } from 'react';
import { useVoiceBiometrics, VERIFICATION_THRESHOLD } from '../hooks/useVoiceBiometrics';

interface Props {
  // Allow parent to know if enrolled
  onEnrolledChange?: (enrolled: boolean) => void;
}

/**
 * Settings panel section for enrolling and managing voice biometric profile.
 * Only the Super Admin's own voice will work for AI voice commands.
 */
export const VoiceEnrollmentSection: React.FC<Props> = ({ onEnrolledChange }) => {
  const {
    isEnrolling,
    isVerifying,
    enrollmentProgress,
    error,
    enrollMulti,
    verify,
    isEnrolled,
    deleteVoicePrint,
  } = useVoiceBiometrics();

  const [enrolled, setEnrolled] = useState(isEnrolled());
  const [lastVerifyResult, setLastVerifyResult] = useState<{ match: boolean; score: number } | null>(null);
  const [recordCountdown, setRecordCountdown] = useState(0);

  // Refresh enrolled state when component mounts
  useEffect(() => {
    setEnrolled(isEnrolled());
  }, [isEnrolled]);

  const handleEnroll = useCallback(async () => {
    // Show countdown
    for (let i = 3; i >= 1; i--) {
      setRecordCountdown(i);
      setLastVerifyResult(null);
      await new Promise((r) => setTimeout(r, 1000));
    }
    setRecordCountdown(0);

    const ok = await enrollMulti();
    if (ok) {
      setEnrolled(true);
      onEnrolledChange?.(true);
    }
  }, [enrollMulti, onEnrolledChange]);

  const handleVerify = useCallback(async () => {
    for (let i = 2; i >= 1; i--) {
      setRecordCountdown(i);
      await new Promise((r) => setTimeout(r, 1000));
    }
    setRecordCountdown(0);

    const result = await verify();
    setLastVerifyResult(result);
  }, [verify]);

  const handleDelete = useCallback(() => {
    deleteVoicePrint();
    setEnrolled(false);
    setLastVerifyResult(null);
    onEnrolledChange?.(false);
  }, [deleteVoicePrint, onEnrolledChange]);

  return (
    <div className="bg-gray-800 rounded-lg p-6 border border-gray-700">
      <div className="flex items-center justify-between mb-4">
        <div>
          <h2 className="text-lg font-semibold text-white">🔊 Voice Biometrics</h2>
          <p className="text-sm text-gray-400 mt-0.5">
            Train the system to recognise <strong className="text-gray-200">only your voice</strong>.
            Once enrolled, voice commands in the AI panel will respond only to you.
          </p>
        </div>
        {enrolled && (
          <span className="px-2.5 py-0.5 bg-green-900/50 border border-green-600 text-green-300 text-xs font-medium rounded-full">
            Enrolled
          </span>
        )}
      </div>

      {/* Status info */}
      <div className="mb-4 text-sm text-gray-400 space-y-1">
        <p>
          🎤 Speak naturally in <strong className="text-gray-200">English or Swahili</strong> — the
          system analyses the <em>shape of your voice</em>, not what you say.
        </p>
        <p>
          📱 Stored <strong className="text-gray-200">only in your browser</strong> (localStorage).
          No voice data leaves your device.
        </p>
      </div>

      {/* Enrollment progress */}
      {isEnrolling && (
        <div className="mb-4">
          <div className="flex items-center gap-3 mb-2">
            <div className="w-5 h-5 border-2 border-emerald-400 border-t-transparent rounded-full animate-spin" />
            <span className="text-emerald-300 text-sm font-medium">
              {recordCountdown > 0
                ? `Recording in ${recordCountdown}...`
                : enrollmentProgress < 60
                  ? 'Recording voice... Speak now!'
                  : 'Processing voiceprint...'}
            </span>
          </div>
          <div className="w-full bg-gray-700 rounded-full h-2">
            <div
              className="bg-emerald-500 h-2 rounded-full transition-all duration-300"
              style={{ width: `${enrollmentProgress}%` }}
            />
          </div>
          <p className="text-gray-500 text-xs mt-1 text-center">
            {enrollmentProgress < 33
              ? 'Recording 1 of 3'
              : enrollmentProgress < 66
                ? 'Recording 2 of 3'
                : enrollmentProgress < 90
                  ? 'Recording 3 of 3'
                  : 'Creating voiceprint...'}
          </p>
        </div>
      )}

      {/* Verify progress */}
      {isVerifying && (
        <div className="mb-4">
          <div className="flex items-center gap-3 mb-2">
            <div className="w-5 h-5 border-2 border-blue-400 border-t-transparent rounded-full animate-spin" />
            <span className="text-blue-300 text-sm font-medium">
              {recordCountdown > 0 ? `Verifying in ${recordCountdown}...` : 'Listening... Say something'}
            </span>
          </div>
        </div>
      )}

      {/* Error */}
      {error && (
        <div className="mb-4 bg-red-900/50 border border-red-500 text-red-200 px-4 py-3 rounded text-sm">
          {error}
        </div>
      )}

      {/* Verify result */}
      {lastVerifyResult && (
        <div className={`mb-4 px-4 py-3 rounded text-sm border ${
          lastVerifyResult.match
            ? 'bg-green-900/40 border-green-600/50 text-green-200'
            : 'bg-yellow-900/40 border-yellow-600/50 text-yellow-200'
        }`}>
          {lastVerifyResult.match ? (
            <>
              ✅ <strong>Identified as you</strong> — match score {Math.round(lastVerifyResult.score * 100)}%.
              Voice can be used for AI commands.
            </>
          ) : (
            <>
              ⚠️ <strong>Voice didn't match</strong> (score {Math.round(lastVerifyResult.score * 100)}%).
              Need at least {Math.round(VERIFICATION_THRESHOLD * 100)}%. Try re-enrolling or speaking clearly.
            </>
          )}
        </div>
      )}

      {/* Action buttons */}
      <div className="flex flex-wrap gap-3">
        {isEnrolling ? (
          <div className="text-gray-500 text-sm italic">Enrollment in progress...</div>
        ) : enrolled ? (
          <>
            <button
              type="button"
              onClick={handleVerify}
              disabled={isVerifying}
              className="px-4 py-2 bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white text-sm rounded-lg transition-colors flex items-center gap-2"
            >
              {isVerifying ? (
                <>
                  <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
                  Listening...
                </>
              ) : (
                '🧪 Test My Voice'
              )}
            </button>
            <button
              type="button"
              onClick={handleEnroll}
              className="px-4 py-2 bg-emerald-600 hover:bg-emerald-700 text-white text-sm rounded-lg transition-colors"
              title="Re-train with a new voice recording"
            >
              🔄 Re-enroll
            </button>
            <button
              type="button"
              onClick={handleDelete}
              className="px-4 py-2 bg-red-600/20 hover:bg-red-600/40 border border-red-600/40 text-red-300 text-sm rounded-lg transition-colors"
            >
              🗑️ Delete Voiceprint
            </button>
          </>
        ) : (
          <button
            type="button"
            onClick={handleEnroll}
            disabled={isEnrolling}
            className="px-5 py-2.5 bg-emerald-600 hover:bg-emerald-700 disabled:opacity-50 text-white font-medium rounded-lg transition-colors flex items-center gap-2"
          >
            {isEnrolling ? (
              <>
                <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
                Enrolling...
              </>
            ) : (
              '🎤 Enroll My Voice'
            )}
          </button>
        )}
      </div>
    </div>
  );
};
