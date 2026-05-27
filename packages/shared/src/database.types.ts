export type Json = string | number | boolean | null | { [key: string]: Json | undefined } | Json[];

export type Database = {
  graphql_public: {
    Tables: {
      [_ in never]: never;
    };
    Views: {
      [_ in never]: never;
    };
    Functions: {
      graphql: {
        Args: {
          extensions?: Json;
          operationName?: string;
          query?: string;
          variables?: Json;
        };
        Returns: Json;
      };
    };
    Enums: {
      [_ in never]: never;
    };
    CompositeTypes: {
      [_ in never]: never;
    };
  };
  public: {
    Tables: {
      ack_cadence_config: {
        Row: {
          house_id: string;
          modified_at: string;
          modified_by: string | null;
          reminder_2h_offset: string | null;
          reminder_6h_offset: string | null;
        };
        Insert: {
          house_id: string;
          modified_at?: string;
          modified_by?: string | null;
          reminder_2h_offset?: string | null;
          reminder_6h_offset?: string | null;
        };
        Update: {
          house_id?: string;
          modified_at?: string;
          modified_by?: string | null;
          reminder_2h_offset?: string | null;
          reminder_6h_offset?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: 'ack_cadence_config_house_id_fkey';
            columns: ['house_id'];
            isOneToOne: true;
            referencedRelation: 'houses';
            referencedColumns: ['id'];
          },
        ];
      };
      break_periods: {
        Row: {
          break_id: string;
          break_name: string;
          break_type: Database['public']['Enums']['break_type_enum'];
          end_date: string;
          profile_name: string;
          start_date: string;
        };
        Insert: {
          break_id?: string;
          break_name: string;
          break_type: Database['public']['Enums']['break_type_enum'];
          end_date: string;
          profile_name: string;
          start_date: string;
        };
        Update: {
          break_id?: string;
          break_name?: string;
          break_type?: Database['public']['Enums']['break_type_enum'];
          end_date?: string;
          profile_name?: string;
          start_date?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'break_periods_profile_name_fkey';
            columns: ['profile_name'];
            isOneToOne: false;
            referencedRelation: 'operating_profiles';
            referencedColumns: ['profile_name'];
          },
        ];
      };
      float_routing: {
        Row: {
          destination_house_id: string;
          precedence_order: number;
          profile_name: string;
          source_house_id: string;
        };
        Insert: {
          destination_house_id: string;
          precedence_order: number;
          profile_name: string;
          source_house_id: string;
        };
        Update: {
          destination_house_id?: string;
          precedence_order?: number;
          profile_name?: string;
          source_house_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'float_routing_destination_house_id_fkey';
            columns: ['destination_house_id'];
            isOneToOne: false;
            referencedRelation: 'houses';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'float_routing_profile_name_fkey';
            columns: ['profile_name'];
            isOneToOne: false;
            referencedRelation: 'operating_profiles';
            referencedColumns: ['profile_name'];
          },
          {
            foreignKeyName: 'float_routing_source_house_id_fkey';
            columns: ['source_house_id'];
            isOneToOne: false;
            referencedRelation: 'houses';
            referencedColumns: ['id'];
          },
        ];
      };
      hm_leave: {
        Row: {
          cancelled_at: string | null;
          end_date: string;
          leave_id: string;
          replacement_user_id: string | null;
          start_date: string;
          status: Database['public']['Enums']['hm_leave_status_enum'];
          user_id: string;
        };
        Insert: {
          cancelled_at?: string | null;
          end_date: string;
          leave_id?: string;
          replacement_user_id?: string | null;
          start_date: string;
          status?: Database['public']['Enums']['hm_leave_status_enum'];
          user_id: string;
        };
        Update: {
          cancelled_at?: string | null;
          end_date?: string;
          leave_id?: string;
          replacement_user_id?: string | null;
          start_date?: string;
          status?: Database['public']['Enums']['hm_leave_status_enum'];
          user_id?: string;
        };
        Relationships: [];
      };
      hmod_rotor: {
        Row: {
          hmod_user_id: string;
          week_start_date: string;
        };
        Insert: {
          hmod_user_id: string;
          week_start_date: string;
        };
        Update: {
          hmod_user_id?: string;
          week_start_date?: string;
        };
        Relationships: [];
      };
      houses: {
        Row: {
          id: string;
          name: string;
        };
        Insert: {
          id: string;
          name: string;
        };
        Update: {
          id?: string;
          name?: string;
        };
        Relationships: [];
      };
      operating_calendar: {
        Row: {
          date: string;
          profile_name: string;
        };
        Insert: {
          date: string;
          profile_name: string;
        };
        Update: {
          date?: string;
          profile_name?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'operating_calendar_profile_name_fkey';
            columns: ['profile_name'];
            isOneToOne: false;
            referencedRelation: 'operating_profiles';
            referencedColumns: ['profile_name'];
          },
        ];
      };
      operating_profiles: {
        Row: {
          claim_phase_alert_offset: string | null;
          claim_phase_close_offset: string | null;
          claim_phase_open_offset: string | null;
          default_cap_enforcement: Database['public']['Enums']['cap_enforcement_enum'];
          default_hours_cap: number;
          escalation_chain: Json;
          float_enabled: boolean;
          profile_name: string;
          scheduling_mode: Database['public']['Enums']['scheduling_mode_enum'];
          shift_end_bound: string;
          shift_start_bound: string;
        };
        Insert: {
          claim_phase_alert_offset?: string | null;
          claim_phase_close_offset?: string | null;
          claim_phase_open_offset?: string | null;
          default_cap_enforcement: Database['public']['Enums']['cap_enforcement_enum'];
          default_hours_cap: number;
          escalation_chain: Json;
          float_enabled: boolean;
          profile_name: string;
          scheduling_mode: Database['public']['Enums']['scheduling_mode_enum'];
          shift_end_bound: string;
          shift_start_bound: string;
        };
        Update: {
          claim_phase_alert_offset?: string | null;
          claim_phase_close_offset?: string | null;
          claim_phase_open_offset?: string | null;
          default_cap_enforcement?: Database['public']['Enums']['cap_enforcement_enum'];
          default_hours_cap?: number;
          escalation_chain?: Json;
          float_enabled?: boolean;
          profile_name?: string;
          scheduling_mode?: Database['public']['Enums']['scheduling_mode_enum'];
          shift_end_bound?: string;
          shift_start_bound?: string;
        };
        Relationships: [];
      };
      scheduling_periods: {
        Row: {
          end_date: string;
          period_id: string;
          period_name: string;
          preference_deadline: string | null;
          profile_name: string;
          published_at: string | null;
          start_date: string;
        };
        Insert: {
          end_date: string;
          period_id?: string;
          period_name: string;
          preference_deadline?: string | null;
          profile_name: string;
          published_at?: string | null;
          start_date: string;
        };
        Update: {
          end_date?: string;
          period_id?: string;
          period_name?: string;
          preference_deadline?: string | null;
          profile_name?: string;
          published_at?: string | null;
          start_date?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'scheduling_periods_profile_name_fkey';
            columns: ['profile_name'];
            isOneToOne: false;
            referencedRelation: 'operating_profiles';
            referencedColumns: ['profile_name'];
          },
        ];
      };
      staffing_patterns: {
        Row: {
          block_headcounts: Json;
          day_type: Database['public']['Enums']['day_type_enum'];
          house_id: string;
          profile_name: string;
        };
        Insert: {
          block_headcounts: Json;
          day_type: Database['public']['Enums']['day_type_enum'];
          house_id: string;
          profile_name: string;
        };
        Update: {
          block_headcounts?: Json;
          day_type?: Database['public']['Enums']['day_type_enum'];
          house_id?: string;
          profile_name?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'staffing_patterns_house_id_fkey';
            columns: ['house_id'];
            isOneToOne: false;
            referencedRelation: 'houses';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'staffing_patterns_profile_name_fkey';
            columns: ['profile_name'];
            isOneToOne: false;
            referencedRelation: 'operating_profiles';
            referencedColumns: ['profile_name'];
          },
        ];
      };
      system_config: {
        Row: {
          config_key: string;
          config_value: string;
          modified_at: string;
          modified_by: string | null;
          notes: string | null;
          value_type: Database['public']['Enums']['value_type_enum'];
        };
        Insert: {
          config_key: string;
          config_value: string;
          modified_at?: string;
          modified_by?: string | null;
          notes?: string | null;
          value_type: Database['public']['Enums']['value_type_enum'];
        };
        Update: {
          config_key?: string;
          config_value?: string;
          modified_at?: string;
          modified_by?: string | null;
          notes?: string | null;
          value_type?: Database['public']['Enums']['value_type_enum'];
        };
        Relationships: [];
      };
      weekly_cap_overrides: {
        Row: {
          cap_enforcement: Database['public']['Enums']['cap_enforcement_enum'];
          hours_cap: number;
          modified_at: string;
          modified_by: string | null;
          week_start_date: string;
        };
        Insert: {
          cap_enforcement: Database['public']['Enums']['cap_enforcement_enum'];
          hours_cap: number;
          modified_at?: string;
          modified_by?: string | null;
          week_start_date: string;
        };
        Update: {
          cap_enforcement?: Database['public']['Enums']['cap_enforcement_enum'];
          hours_cap?: number;
          modified_at?: string;
          modified_by?: string | null;
          week_start_date?: string;
        };
        Relationships: [];
      };
    };
    Views: {
      [_ in never]: never;
    };
    Functions: {
      [_ in never]: never;
    };
    Enums: {
      break_type_enum:
        | 'thanksgiving'
        | 'fall_break'
        | 'spring_break'
        | 'spring_fling'
        | 'winter_break'
        | 'other';
      cap_enforcement_enum: 'soft' | 'hard';
      day_type_enum: 'weekday' | 'weekend';
      hm_leave_status_enum: 'active' | 'cancelled_early';
      scheduling_mode_enum: 'sm_built' | 'claim_based';
      value_type_enum: 'integer' | 'interval' | 'time_of_day' | 'enum';
    };
    CompositeTypes: {
      [_ in never]: never;
    };
  };
};

type DatabaseWithoutInternals = Omit<Database, '__InternalSupabase'>;

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, 'public'>];

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema['Tables'] & DefaultSchema['Views'])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions['schema']]['Tables'] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions['schema']]['Views'])
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals;
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions['schema']]['Tables'] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions['schema']]['Views'])[TableName] extends {
      Row: infer R;
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema['Tables'] & DefaultSchema['Views'])
    ? (DefaultSchema['Tables'] & DefaultSchema['Views'])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R;
      }
      ? R
      : never
    : never;

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema['Tables']
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions['schema']]['Tables']
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals;
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions['schema']]['Tables'][TableName] extends {
      Insert: infer I;
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema['Tables']
    ? DefaultSchema['Tables'][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I;
      }
      ? I
      : never
    : never;

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema['Tables']
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions['schema']]['Tables']
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals;
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions['schema']]['Tables'][TableName] extends {
      Update: infer U;
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema['Tables']
    ? DefaultSchema['Tables'][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U;
      }
      ? U
      : never
    : never;

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema['Enums']
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions['schema']]['Enums']
    : never = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals;
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions['schema']]['Enums'][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema['Enums']
    ? DefaultSchema['Enums'][DefaultSchemaEnumNameOrOptions]
    : never;

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema['CompositeTypes']
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions['schema']]['CompositeTypes']
    : never = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals;
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions['schema']]['CompositeTypes'][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema['CompositeTypes']
    ? DefaultSchema['CompositeTypes'][PublicCompositeTypeNameOrOptions]
    : never;

export const Constants = {
  graphql_public: {
    Enums: {},
  },
  public: {
    Enums: {
      break_type_enum: [
        'thanksgiving',
        'fall_break',
        'spring_break',
        'spring_fling',
        'winter_break',
        'other',
      ],
      cap_enforcement_enum: ['soft', 'hard'],
      day_type_enum: ['weekday', 'weekend'],
      hm_leave_status_enum: ['active', 'cancelled_early'],
      scheduling_mode_enum: ['sm_built', 'claim_based'],
      value_type_enum: ['integer', 'interval', 'time_of_day', 'enum'],
    },
  },
} as const;
