import { IsDefined, IsString } from 'class-validator';

export class DatabaseConfig {
  @IsDefined()
  @IsString()
  URL!: string;
}
