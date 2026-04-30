import React from 'react';
import { Group, Rect, Line, Text } from 'react-konva';
import { ToolState } from '../../types/whiteboard';

interface RulerProps {
  state: ToolState;
  onChange: (newState: ToolState) => void;
  documentScale?: number;
  draggable?: boolean;
  listening?: boolean;
}

export const Ruler: React.FC<RulerProps> = React.memo(({ state, onChange, documentScale = 1, draggable = true, listening = true }) => {
  // Initial width is 10 inches by default
  const inchStep = 98.425 * state.scale; 
  const width = 10 * inchStep;
  const height = 120 * state.scale;  
  const markings = React.useMemo(() => {
    const result = [];
    
    // Ruler base width limit in inches
    const maxInches = Math.floor(width / inchStep);
    
    for (let i = 0; i <= maxInches; i++) {
      const x = i * inchStep;
      
      // Inch Marker (Whole numbers)
      result.push(
        <React.Fragment key={`inch-${i}`}>
          <Line
            points={[x, 0, x, 32]}
            stroke="#0f172a"
            strokeWidth={2.5}
          />
          <Text
            x={x + 6}
            y={height - 40}
            text={`${i}"`}
            fontSize={20}
            fontStyle="bold"
            fill="#0f172a"
          />
          
          {/* Subdivisions (1/16 inch increments for better accuracy) */}
          {i < maxInches && Array.from({ length: 15 }).map((_, j) => {
            const subIndex = j + 1; // 1 to 15
            const subX = x + (subIndex * inchStep / 16);
            
            // Determine height based on fraction
            let h = 8;
            let weight = 1;
            let color = "#94a3b8";
            
            if (subIndex === 8) { // 1/2 inch
              h = 24;
              weight = 2;
              color = "#334155";
            } else if (subIndex === 4 || subIndex === 12) { // 1/4 and 3/4 inch
              h = 18;
              weight = 1.5;
              color = "#475569";
            } else if (subIndex % 2 === 0) { // 1/8 increments
              h = 12;
              weight = 1;
              color = "#64748b";
            }

            return (
              <Line
                key={`sub-${i}-${j}`}
                points={[subX, 0, subX, h]}
                stroke={color}
                strokeWidth={weight}
              />
            );
          })}
        </React.Fragment>
      );
    }
    return result;
  }, [width, inchStep]);

  return (
    <Group
      x={state.x}
      y={state.y}
      rotation={state.rotation}
      draggable={draggable}
      onDragEnd={(e) => {
        if (e.target !== e.currentTarget) return;
        onChange({ ...state, x: e.target.x(), y: e.target.y() });
      }}
      visible={state.visible}
      listening={listening}
    >
      {/* Ruler Body */}
      <Rect
        width={width}
        height={height}
        fill="rgba(251, 191, 36, 0.8)" /* Amber/Yellow from Bento design */
        stroke="#0f172a"
        strokeWidth={2}
        cornerRadius={8}
        shadowBlur={0}
        shadowOffset={{ x: 3, y: 3 }}
        shadowColor="#0f172a"
        shadowOpacity={1}
      />
      
      {markings}

      {/* Rotation Handle */}
      <Rect
        x={width - 30}
        y={height / 2 - 15}
        width={30}
        height={30}
        fill="#3b82f6"
        cornerRadius={15}
        draggable={draggable}
        onDragMove={(e) => {
          const stage = e.target.getStage();
          if (!stage) return;
          const pos = stage.getPointerPosition();
          if (!pos) return;
          
          // Compensate for stage scale to get layer coordinates
          const dx = (pos.x / documentScale) - state.x;
          const dy = (pos.y / documentScale) - state.y;
          const angle = (Math.atan2(dy, dx) * 180) / Math.PI;
          
          onChange({ ...state, rotation: angle });
          // Reset handle position so it doesn't stay where it was dragged
          e.target.x(width - 30);
          e.target.y(height / 2 - 15);
        }}
      />
    </Group>
  );
});
