import React from 'react';
import { Group, Arc, Line, Text, Circle } from 'react-konva';
import { ToolState } from '../../types/whiteboard';

interface ProtractorProps {
  state: ToolState;
  onChange: (newState: ToolState) => void;
  documentScale?: number;
  resolutionScale?: number;
  draggable?: boolean;
  listening?: boolean;
}

export const Protractor: React.FC<ProtractorProps> = React.memo(({ state, onChange, documentScale = 1, resolutionScale = 1, draggable = true, listening = true }) => {
  const radius = 280 * state.scale * resolutionScale;
  
  const markings = React.useMemo(() => {
    const result = [];
    for (let i = 0; i <= 180; i++) {
      const angleRad = (i * Math.PI) / 180;
      const isMajor = i % 10 === 0;
      const isMedium = i % 5 === 0;
      
      const outerR = radius;
      const innerR = radius - (isMajor ? 25 : isMedium ? 15 : 8);
      
      const x1 = Math.cos(angleRad) * outerR;
      const y1 = -Math.sin(angleRad) * outerR;
      const x2 = Math.cos(angleRad) * innerR;
      const y2 = -Math.sin(angleRad) * innerR;
      
      result.push(
        <React.Fragment key={i}>
          <Line
            points={[x1, y1, x2, y2]}
            stroke={isMajor ? "#1e293b" : isMedium ? "#475569" : "#94a3b8"}
            strokeWidth={isMajor ? 2 : 1}
          />
          {isMajor && (
            <>
              {/* Outer Scale: 180 (left) to 0 (right) */}
              <Text
                x={Math.cos(angleRad) * (radius - 40) - 10}
                y={-Math.sin(angleRad) * (radius - 40) - 5}
                text={`${180 - i}`}
                fontSize={18}
                fontStyle="bold"
                fill="#0f172a"
                rotation={-i}
                align="center"
                verticalAlign="middle"
               />
               {/* Inner Scale: 0 (left) to 180 (right) */}
               <Text
                x={Math.cos(angleRad) * (radius - 64) - 10}
                y={-Math.sin(angleRad) * (radius - 64) - 5}
                text={`${i}`}
                fontSize={15}
                fill="#475569"
                fontStyle="bold"
                rotation={-i}
                align="center"
                verticalAlign="middle"
               />
            </>
          )}
        </React.Fragment>
      );
    }
    return result;
  }, [radius]);

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
      {/* Semi-Circle Body */}
      <Arc
        angle={180}
        rotation={180}
        innerRadius={0}
        outerRadius={radius}
        fill="rgba(56, 189, 248, 0.6)" /* Sky-400 with 0.6 opacity */
        stroke="#0f172a"
        strokeWidth={3}
      />
      
      {/* Base Line */}
      <Line
        points={[-radius, 0, radius, 0]}
        stroke="#0f172a"
        strokeWidth={3}
      />
      
      {/* Center Point */}
      <Circle
        radius={4}
        fill="#0f172a"
      />
      
      {markings}

      {/* Rotation Handle - Positioned on the arc edge */}
      <Circle
        x={0}
        y={-radius}
        radius={12}
        fill="#3b82f6"
        stroke="#fff"
        strokeWidth={2}
        draggable={draggable}
        onDragMove={(e) => {
          const stage = e.target.getStage();
          if (!stage) return;
          const pos = stage.getPointerPosition();
          if (!pos) return;
          
          // Compensate for stage scale to get layer coordinates
          const dx = (pos.x / documentScale) - state.x;
          const dy = (pos.y / documentScale) - state.y;
          // Calculate angle relative to the center
          // +90 because our handle is at (0, -radius) which is -90 degrees
          const angle = (Math.atan2(dy, dx) * 180) / Math.PI + 90;
          
          onChange({ ...state, rotation: angle });
          // Snap handle back to its relative position
          e.target.x(0);
          e.target.y(-radius);
        }}
        shadowBlur={5}
        shadowColor="rgba(0,0,0,0.3)"
      />
    </Group>
  );
});

