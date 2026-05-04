import React from 'react';
import { Group, Rect, Line, Text } from 'react-konva';
import { ToolState } from '../../types/whiteboard';

interface RulerProps {
  state: ToolState;
  onChange: (newState: ToolState) => void;
  documentScale?: number;
  resolutionScale?: number;
  draggable?: boolean;
  listening?: boolean;
}

export const Ruler: React.FC<RulerProps> = React.memo(({ state, onChange, documentScale = 1, resolutionScale = 1, draggable = true, listening = true }) => {
  const isCm = state.unit === 'cm';
  
  // 1 inch = 96 pixels at standard resolution
  const inchStep = 96 * state.scale * resolutionScale;
  // 1 cm = 96 / 2.54 pixels
  const cmStep = (96 / 2.54) * state.scale * resolutionScale;
  
  const unitStep = isCm ? cmStep : inchStep;
  const numUnits = isCm ? 20 : 8; // 20 units (8in or 20cm)
  const width = numUnits * unitStep;
  const height = 90 * state.scale * resolutionScale;

  const markings = React.useMemo(() => {
    const result = [];
    
    for (let i = 0; i <= numUnits; i++) {
      const x = i * unitStep;
      
      // Major Marker
      result.push(
        <React.Fragment key={`unit-${i}`}>
          <Line
            points={[x, 0, x, 32]}
            stroke="#0f172a"
            strokeWidth={2.5}
          />
          <Text
            x={x + 6}
            y={height - 40}
            text={`${i}${isCm ? '' : '"'}`}
            fontSize={20}
            fontStyle="bold"
            fill="#0f172a"
          />
          
          {/* Subdivisions */}
          {i < numUnits && (isCm ? (
            // Centimeter subdivisions (10 mm)
            Array.from({ length: 9 }).map((_, j) => {
              const mmIndex = j + 1;
              const mmX = x + (mmIndex * unitStep / 10);
              const h = mmIndex === 5 ? 18 : 10;
              const weight = mmIndex === 5 ? 1.5 : 1;
              
              return (
                <Line
                  key={`mm-${i}-${j}`}
                  points={[mmX, 0, mmX, h]}
                  stroke="#475569"
                  strokeWidth={weight}
                />
              );
            })
          ) : (
            // Inch subdivisions (1/16 inch)
            Array.from({ length: 15 }).map((_, j) => {
              const subIndex = j + 1;
              const subX = x + (subIndex * unitStep / 16);
              
              let h = 8;
              let weight = 1;
              let color = "#94a3b8";
              
              if (subIndex === 8) { h = 24; weight = 2; color = "#334155"; }
              else if (subIndex === 4 || subIndex === 12) { h = 18; weight = 1.5; color = "#475569"; }
              else if (subIndex % 2 === 0) { h = 12; weight = 1; color = "#64748b"; }

              return (
                <Line
                  key={`sub-${i}-${j}`}
                  points={[subX, 0, subX, h]}
                  stroke={color}
                  strokeWidth={weight}
                />
              );
            })
          ))}
        </React.Fragment>
      );
    }
    return result;
  }, [width, unitStep, isCm, height, numUnits]);

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
