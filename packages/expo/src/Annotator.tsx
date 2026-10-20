import { useMemo, useRef, useState } from 'react'
import {
  Image,
  Modal,
  PanResponder,
  Pressable,
  StyleSheet,
  Text,
  useWindowDimensions,
  View,
} from 'react-native'
import { type AnnotationBox, boxFromDrag, MAX_ANNOTATIONS } from './core/annotations.js'
import type { Screenshot } from './screenshot.js'

/**
 * Full-screen markup for a report's screenshot: drag to draw a box, Highlight
 * to point at something, Blur to hide personal data. The server applies the
 * boxes before storing the image.
 */
export function Annotator({
  screenshot,
  initial,
  onDone,
  onCancel,
}: {
  screenshot: Screenshot
  initial: AnnotationBox[]
  onDone: (boxes: AnnotationBox[]) => void
  onCancel: () => void
}) {
  const window = useWindowDimensions()
  const [boxes, setBoxes] = useState(initial)
  const [kind, setKind] = useState<AnnotationBox['kind']>('highlight')
  const [draft, setDraft] = useState<AnnotationBox | null>(null)
  const [aspect, setAspect] = useState(window.width / window.height)
  const uri = `data:${screenshot.contentType};base64,${screenshot.base64}`

  // The image is shown at the screenshot's aspect ratio, so fractions map 1:1.
  const maxWidth = window.width - 32
  const maxHeight = window.height - 200
  const width = Math.min(maxWidth, maxHeight * aspect)
  const height = width / aspect

  const state = useRef({ start: { x: 0, y: 0 }, draft: null as AnnotationBox | null, kind, boxes })
  state.current.kind = kind
  state.current.boxes = boxes

  const responder = useMemo(
    () =>
      PanResponder.create({
        onStartShouldSetPanResponder: () => true,
        onMoveShouldSetPanResponder: () => true,
        onPanResponderGrant: (event) => {
          state.current.start = { x: event.nativeEvent.locationX, y: event.nativeEvent.locationY }
          state.current.draft = null
        },
        onPanResponderMove: (_event, gesture) => {
          const { start } = state.current
          const next = boxFromDrag(
            state.current.kind,
            start,
            { x: start.x + gesture.dx, y: start.y + gesture.dy },
            { width, height },
          )
          state.current.draft = next
          setDraft(next)
        },
        onPanResponderRelease: () => {
          const finished = state.current.draft
          if (finished && state.current.boxes.length < MAX_ANNOTATIONS) {
            setBoxes([...state.current.boxes, finished])
          }
          state.current.draft = null
          setDraft(null)
        },
      }),
    [width, height],
  )

  return (
    <Modal visible animationType="fade" onRequestClose={onCancel}>
      <View style={styles.screen}>
        <View style={styles.toolbar}>
          <Pressable onPress={onCancel} accessibilityRole="button" hitSlop={8}>
            <Text style={styles.toolbarText}>Cancel</Text>
          </Pressable>
          <View style={styles.modes}>
            {(['highlight', 'blur'] as const).map((mode) => (
              <Pressable
                key={mode}
                onPress={() => setKind(mode)}
                style={[styles.mode, kind === mode && styles.modeActive]}
                accessibilityRole="radio"
                accessibilityState={{ selected: kind === mode }}
              >
                <Text style={[styles.modeText, kind === mode && styles.modeTextActive]}>
                  {mode === 'highlight' ? 'Highlight' : 'Blur'}
                </Text>
              </Pressable>
            ))}
          </View>
          <Pressable onPress={() => onDone(boxes)} accessibilityRole="button" hitSlop={8}>
            <Text style={[styles.toolbarText, styles.done]}>Done</Text>
          </Pressable>
        </View>

        <View style={{ width, height }} {...responder.panHandlers}>
          <Image
            source={{ uri }}
            style={{ width, height }}
            onLoad={(event) => {
              const { width: w, height: h } = event.nativeEvent.source
              if (w && h) setAspect(w / h)
            }}
            accessibilityLabel="Screenshot to mark up"
          />
          {[...boxes, ...(draft ? [draft] : [])].map((box, index) => (
            <View
              // biome-ignore lint/suspicious/noArrayIndexKey: boxes have no identity beyond their order
              key={index}
              pointerEvents="none"
              style={[
                styles.box,
                box.kind === 'blur' ? styles.blurBox : styles.highlightBox,
                {
                  left: box.x * width,
                  top: box.y * height,
                  width: box.w * width,
                  height: box.h * height,
                },
              ]}
            >
              {box.kind === 'blur' ? <Text style={styles.blurLabel}>Blurred</Text> : null}
            </View>
          ))}
        </View>

        <View style={styles.footer}>
          <Text style={styles.hint}>
            {boxes.length === 0
              ? 'Drag on the screenshot to draw a box.'
              : `${boxes.length} mark${boxes.length === 1 ? '' : 's'}`}
          </Text>
          {boxes.length > 0 ? (
            <Pressable
              onPress={() => setBoxes(boxes.slice(0, -1))}
              accessibilityRole="button"
              hitSlop={8}
            >
              <Text style={styles.toolbarText}>Undo</Text>
            </Pressable>
          ) : null}
        </View>
      </View>
    </Modal>
  )
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 16,
    backgroundColor: '#111114',
    paddingVertical: 48,
  },
  toolbar: {
    width: '100%',
    paddingHorizontal: 16,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  toolbarText: { color: '#ffffff', fontSize: 16 },
  done: { fontWeight: '700', color: '#8ab4f8' },
  modes: { flexDirection: 'row', borderRadius: 999, backgroundColor: '#2a2b31', padding: 3 },
  mode: { paddingVertical: 6, paddingHorizontal: 14, borderRadius: 999 },
  modeActive: { backgroundColor: '#ffffff' },
  modeText: { color: '#d4d4d8', fontSize: 14, fontWeight: '600' },
  modeTextActive: { color: '#111114' },
  box: { position: 'absolute', borderRadius: 6, alignItems: 'center', justifyContent: 'center' },
  highlightBox: { borderWidth: 3, borderColor: '#e5484d' },
  blurBox: { backgroundColor: 'rgba(40, 40, 46, 0.85)' },
  blurLabel: { color: '#ffffff', fontSize: 12, fontWeight: '600' },
  footer: {
    width: '100%',
    paddingHorizontal: 16,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  hint: { color: '#a1a1aa', fontSize: 14 },
})
