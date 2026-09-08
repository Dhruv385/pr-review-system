import { IsDefined, IsString } from 'class-validator';

export class GithubConfig {
  @IsDefined()
  @IsString()
  CLIENT_ID!: string;

  @IsDefined()
  @IsString()
  CLIENT_SECRET!: string;

  @IsDefined()
  @IsString()
  CALLBACK_URL!: string;
}
