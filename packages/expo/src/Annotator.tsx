import { useEffect, useMemo, useRef, useState } from 'react'
import {
  Animated,
  Image,
  PanResponder,
  Pressable,
  StyleSheet,
  Text,
  useWindowDimensions,
  View,
} from 'react-native'
import {
  type Annotation,
  type AnnotationStroke,
  addStrokePoint,
  boxFromDrag,
  finishStroke,
  MAX_ANNOTATIONS,
  strokeSegments,
} from './core/annotations.js'
import { useBackPress } from './Overlay.js'
import type { Screenshot } from './screenshot.js'

type Mode = 'draw' | 'highlight' | 'blur'

const MODES: { mode: Mode; title: string; hint: string }[] = [
  { mode: 'draw', title: 'Draw', hint: 'Draw on the screenshot to circle or point at something.' },
  { mode: 'highlight', title: 'Box', hint: 'Drag on the screenshot to draw a box.' },
  { mode: 'blur', title: 'Blur', hint: 'Drag over anything private to blur it.' },
]

/**
 * Full-screen markup for a report's screenshot: Draw to circle or point at
 * something freehand, Box to outline it, Blur to hide personal data. The
 * server applies the marks before storing the image.
 */
export function Annotator({
  screenshot,
  initial,
  onDone,
  onCancel,
}: {
  screenshot: Screenshot
  initial: Annotation[]
  onDone: (marks: Annotation[]) => void
  onCancel: () => void
}) {
  const window = useWindowDimensions()
  const [boxes, setBoxes] = useState(initial)
  const [kind, setKind] = useState<Mode>('draw')
  const [draft, setDraft] = useState<Annotation | null>(null)
  const [aspect, setAspect] = useState(window.width / window.height)
  const uri = `data:${screenshot.contentType};base64,${screenshot.base64}`
  const shown = useRef(new Animated.Value(0)).current
  useBackPress(onCancel)
  useEffect(() => {
    Animated.timing(shown, { toValue: 1, duration: 180, useNativeDriver: true }).start()
  }, [shown])

  // The image is shown at the screenshot's aspect ratio, so fractions map 1:1.
  const maxWidth = window.width - 32
  const maxHeight = window.height - 200
  const width = Math.min(maxWidth, maxHeight * aspect)
  const height = width / aspect

  const state = useRef({
    start: { x: 0, y: 0 },
    draft: null as Annotation | null,
    points: [] as [number, number][],
    kind,
    boxes,
  })
  state.current.kind = kind
  state.current.boxes = boxes

  const responder = useMemo(
    () =>
      PanResponder.create({
        onStartShouldSetPanResponder: () => true,
        onMoveShouldSetPanResponder: () => true,
        onPanResponderGrant: (event) => {
          const start = { x: event.nativeEvent.locationX, y: event.nativeEvent.locationY }
          state.current.start = start
          state.current.draft = null
          state.current.points =
            state.current.kind === 'draw' ? addStrokePoint([], start, { width, height }) : []
        },
        onPanResponderMove: (_event, gesture) => {
          const { start, kind: mode } = state.current
          const at = { x: start.x + gesture.dx, y: start.y + gesture.dy }
          if (mode === 'draw') {
            const points = addStrokePoint(state.current.points, at, { width, height })
            if (points === state.current.points) return
            state.current.points = points
            const stroke: AnnotationStroke = { kind: 'draw', points }
            state.current.draft = stroke
            setDraft(stroke)
            return
          }
          const next = boxFromDrag(mode, start, at, { width, height })
          state.current.draft = next
          setDraft(next)
        },
        onPanResponderRelease: () => {
          const { draft: current } = state.current
          const finished = current?.kind === 'draw' ? finishStroke(current.points) : current
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
    <Animated.View style={[StyleSheet.absoluteFill, { opacity: shown }]} accessibilityViewIsModal>
      <View style={styles.screen}>
        <View style={styles.toolbar}>
          <Pressable onPress={onCancel} accessibilityRole="button" hitSlop={8}>
            <Text style={styles.toolbarText}>Cancel</Text>
          </Pressable>
          <View style={styles.modes}>
            {MODES.map(({ mode, title }) => (
              <Pressable
                key={mode}
                onPress={() => setKind(mode)}
                style={[styles.mode, kind === mode && styles.modeActive]}
                accessibilityRole="radio"
                accessibilityState={{ selected: kind === mode }}
              >
                <Text style={[styles.modeText, kind === mode && styles.modeTextActive]}>
                  {title}
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
          {[...boxes, ...(draft ? [draft] : [])].map((box, index) =>
            box.kind === 'draw' ? (
              // biome-ignore lint/suspicious/noArrayIndexKey: marks have no identity beyond their order
              <Stroke key={index} points={box.points} width={width} height={height} />
            ) : (
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
            ),
          )}
        </View>

        <View style={styles.footer}>
          <Text style={styles.hint}>
            {boxes.length === 0
              ? MODES.find((m) => m.mode === kind)?.hint
              : boxes.length >= MAX_ANNOTATIONS
                ? `${MAX_ANNOTATIONS} marks is the most. Undo one to add another.`
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
    </Animated.View>
  )
}

const STROKE_WIDTH = 4

/** A freehand mark, drawn as short rotated bars so it needs no SVG library. */
function Stroke({
  points,
  width,
  height,
}: {
  points: [number, number][]
  width: number
  height: number
}) {
  return (
    <>
      {strokeSegments(points, { width, height }).map((segment, i) => (
        <View
          // biome-ignore lint/suspicious/noArrayIndexKey: segments are positional
          key={i}
          pointerEvents="none"
          style={[
            styles.segment,
            {
              left: segment.left,
              top: segment.top - STROKE_WIDTH / 2,
              // A little longer than the gap, so joints don't show.
              width: segment.length + STROKE_WIDTH / 2,
              transform: [{ rotate: `${segment.angle}rad` }],
            },
          ]}
        />
      ))}
    </>
  )
}

const styles = StyleSheet.create({
  segment: {
    position: 'absolute',
    height: STROKE_WIDTH,
    borderRadius: STROKE_WIDTH / 2,
    backgroundColor: '#e5484d',
  },
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
