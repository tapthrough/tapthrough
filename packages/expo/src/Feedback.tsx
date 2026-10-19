import Constants from 'expo-constants'
import { usePathname } from 'expo-router'
import { useMemo, useState } from 'react'
import {
  ActivityIndicator,
  Image,
  KeyboardAvoidingView,
  Linking,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  TextInput,
  View,
} from 'react-native'
import { previewContextFromManifest, sendFeedback } from './core/feedback.js'
import { controller } from './runtime.js'
import { captureScreenshot, type Screenshot } from './screenshot.js'

/** Remembered for the session, so reviewers type their name once. */
let rememberedName = ''

function deviceInfo() {
  const constants = Platform.constants as unknown as Record<string, unknown>
  if (Platform.OS === 'ios') {
    return {
      os: 'iOS',
      osVersion: String(Platform.Version),
      model: constants.interfaceIdiom === 'pad' ? 'iPad' : 'iPhone',
    }
  }
  const model = [constants.Manufacturer, constants.Model].filter(Boolean).join(' ')
  return {
    os: 'Android',
    osVersion: String(constants.Release ?? Platform.Version),
    ...(model ? { model } : {}),
  }
}

function nextFrame() {
  return new Promise<void>((resolve) =>
    requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
  )
}

/**
 * A small Report button over a PR preview. It screenshots the screen (with
 * itself hidden), then opens a composer that posts the note to the PR.
 */
export function ReportButton({ apiUrl }: { apiUrl: string }) {
  const preview = useMemo(() => previewContextFromManifest(Constants.manifest2), [])
  const pathname = usePathname()
  const [phase, setPhase] = useState<'idle' | 'capturing' | 'composing'>('idle')
  const [screenshot, setScreenshot] = useState<Screenshot | null>(null)

  if (!preview || (Platform.OS !== 'ios' && Platform.OS !== 'android')) return null

  async function open() {
    setPhase('capturing')
    await nextFrame()
    setScreenshot(await captureScreenshot())
    setPhase('composing')
  }

  function close() {
    setPhase('idle')
    setScreenshot(null)
  }

  return (
    <>
      {phase === 'idle' ? (
        <Pressable
          onPress={open}
          style={({ pressed }) => [styles.pill, pressed && styles.pressed]}
          accessibilityRole="button"
          accessibilityLabel="Report an issue with this pull request"
          hitSlop={8}
        >
          <Text style={styles.pillText}>Report</Text>
        </Pressable>
      ) : null}
      {phase === 'composing' ? (
        <Composer
          screenshot={screenshot}
          route={pathname}
          branch={preview.branch}
          onSend={(input) =>
            sendFeedback(
              {
                ...input,
                preview,
                platform: Platform.OS as 'ios' | 'android',
                route: pathname,
                device: deviceInfo(),
                ...(controller.lastScenarioId() ? { scenarioId: controller.lastScenarioId() } : {}),
              },
              { apiUrl },
            )
          }
          onClose={close}
        />
      ) : null}
    </>
  )
}

type Status =
  | { kind: 'editing' }
  | { kind: 'sending' }
  | { kind: 'sent'; commentUrl: string }
  | { kind: 'error'; message: string }

function Composer({
  screenshot,
  route,
  branch,
  onSend,
  onClose,
}: {
  screenshot: Screenshot | null
  route: string
  branch: string | undefined
  onSend: (input: {
    body: string
    reporterName?: string
    screenshot?: Screenshot
  }) => ReturnType<typeof sendFeedback>
  onClose: () => void
}) {
  const [body, setBody] = useState('')
  const [name, setName] = useState(rememberedName)
  const [includeScreenshot, setIncludeScreenshot] = useState(screenshot !== null)
  const [status, setStatus] = useState<Status>({ kind: 'editing' })
  const pr = branch?.match(/^pr-(\d+)$/)?.[1]

  async function send() {
    rememberedName = name.trim()
    setStatus({ kind: 'sending' })
    const result = await onSend({
      body: body.trim(),
      ...(name.trim() ? { reporterName: name.trim() } : {}),
      ...(includeScreenshot && screenshot ? { screenshot } : {}),
    })
    setStatus(
      result.ok
        ? { kind: 'sent', commentUrl: result.commentUrl }
        : { kind: 'error', message: result.message },
    )
  }

  return (
    <Modal visible transparent animationType="slide" onRequestClose={onClose}>
      <KeyboardAvoidingView
        style={styles.backdrop}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <View style={styles.sheet}>
          {status.kind === 'sent' ? (
            <View style={styles.sent}>
              <Text style={styles.title}>Sent to {pr ? `PR #${pr}` : 'the PR'}</Text>
              <Text style={styles.muted}>Your report is a comment on the pull request now.</Text>
              <View style={styles.actions}>
                <Pressable
                  onPress={() => Linking.openURL(status.commentUrl)}
                  accessibilityRole="link"
                >
                  <Text style={styles.link}>View on GitHub</Text>
                </Pressable>
                <Pressable onPress={onClose} style={styles.primary} accessibilityRole="button">
                  <Text style={styles.primaryText}>Done</Text>
                </Pressable>
              </View>
            </View>
          ) : (
            <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={styles.form}>
              <Text style={styles.title}>Report an issue{pr ? ` on PR #${pr}` : ''}</Text>
              <Text style={styles.muted} numberOfLines={1}>
                On {route}
              </Text>
              {screenshot ? (
                <View style={styles.shotRow}>
                  <Image
                    source={{ uri: `data:${screenshot.contentType};base64,${screenshot.base64}` }}
                    style={[styles.shot, !includeScreenshot && styles.shotOff]}
                    resizeMode="contain"
                    accessibilityLabel="Screenshot of the current screen"
                  />
                  <View style={styles.shotToggle}>
                    <Text style={styles.label}>Include screenshot</Text>
                    <Switch value={includeScreenshot} onValueChange={setIncludeScreenshot} />
                  </View>
                </View>
              ) : null}
              <TextInput
                value={body}
                onChangeText={setBody}
                placeholder="What's wrong? What did you expect?"
                placeholderTextColor="#8a8f98"
                multiline
                autoFocus
                style={[styles.input, styles.body]}
                accessibilityLabel="What's wrong"
              />
              <TextInput
                value={name}
                onChangeText={setName}
                placeholder="Your name (optional)"
                placeholderTextColor="#8a8f98"
                autoCapitalize="words"
                style={styles.input}
                accessibilityLabel="Your name"
              />
              {status.kind === 'error' ? (
                <Text style={styles.error} accessibilityRole="alert">
                  {status.message}
                </Text>
              ) : null}
              <View style={styles.actions}>
                <Pressable onPress={onClose} accessibilityRole="button" hitSlop={8}>
                  <Text style={styles.link}>Cancel</Text>
                </Pressable>
                <Pressable
                  onPress={send}
                  disabled={!body.trim() || status.kind === 'sending'}
                  style={[
                    styles.primary,
                    (!body.trim() || status.kind === 'sending') && styles.disabled,
                  ]}
                  accessibilityRole="button"
                >
                  {status.kind === 'sending' ? (
                    <ActivityIndicator color="#ffffff" />
                  ) : (
                    <Text style={styles.primaryText}>Send to PR</Text>
                  )}
                </Pressable>
              </View>
            </ScrollView>
          )}
        </View>
      </KeyboardAvoidingView>
    </Modal>
  )
}

const styles = StyleSheet.create({
  pill: {
    position: 'absolute',
    right: 16,
    bottom: 44,
    paddingVertical: 8,
    paddingHorizontal: 14,
    borderRadius: 999,
    backgroundColor: 'rgba(24, 24, 27, 0.88)',
  },
  pressed: { opacity: 0.7 },
  pillText: { color: '#ffffff', fontSize: 14, fontWeight: '600' },
  backdrop: { flex: 1, justifyContent: 'flex-end', backgroundColor: 'rgba(0, 0, 0, 0.4)' },
  sheet: {
    maxHeight: '90%',
    borderTopLeftRadius: 16,
    borderTopRightRadius: 16,
    backgroundColor: '#ffffff',
  },
  form: { padding: 20, gap: 12 },
  sent: { padding: 20, paddingBottom: 40, gap: 8 },
  title: { fontSize: 18, fontWeight: '700', color: '#16181d' },
  muted: { fontSize: 13, color: '#5f6672' },
  label: { fontSize: 14, color: '#16181d' },
  shotRow: { flexDirection: 'row', gap: 12, alignItems: 'center' },
  shot: { width: 72, height: 150, borderRadius: 8, backgroundColor: '#f1f2f4' },
  shotOff: { opacity: 0.3 },
  shotToggle: { flex: 1, gap: 6, alignItems: 'flex-start' },
  input: {
    fontSize: 16,
    color: '#16181d',
    borderWidth: 1,
    borderColor: '#d8dbe0',
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  body: { minHeight: 100, textAlignVertical: 'top' },
  error: { fontSize: 14, color: '#c5221f' },
  actions: {
    marginTop: 4,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  link: { fontSize: 16, fontWeight: '600', color: '#1a73e8' },
  primary: {
    minWidth: 120,
    alignItems: 'center',
    paddingVertical: 12,
    paddingHorizontal: 18,
    borderRadius: 10,
    backgroundColor: '#1a73e8',
  },
  primaryText: { color: '#ffffff', fontSize: 16, fontWeight: '600' },
  disabled: { opacity: 0.4 },
})
